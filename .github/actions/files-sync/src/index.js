// Require modules.
import * as core from '@actions/core';
import * as github from '@actions/github';
import {readFileSync} from 'fs';
import * as yaml from 'js-yaml';
import {Octokit} from '@octokit/core';
import {createOrUpdateTextFile} from '@octokit/plugin-create-or-update-text-file';

// Setup global vars.
let
    reposConfig       = {},
    _octokitInstances = {};

const
    secrets = JSON.parse(core.getInput('secrets')),
    org     = core.getInput('org'),
    what    = core.getInput('what');

let processDeletion = core.getInput('process_deletion');

/**
 * Create an array of {repo : { project, owner, secrets }...} and save it globally.
 */
const buildreposConfig = async () => {
    const
        teamsConfig = yaml.load(
            readFileSync(
                `${ process.env.GITHUB_WORKSPACE }/defs/teams-config.yml`,
                'utf8'
            )
        ),
        octokit    = _getOctokitInstance(secrets.CSPF_REPO_READ_PAT);

    let repos = await octokit.paginate(
        'GET /orgs/{org}/repos',
        {
            org,
        }
    );
    repos = repos
        .filter(({archived, disabled, fork}) => false === archived && false === disabled && false === fork);

    repos.forEach((repo) => {
        reposConfig[repo.name] = reposConfig[repo.name] || [];
        for ( const team in teamsConfig ) {
            const teamConfig = teamsConfig[team];
            if (teamConfig.repos.includes(repo.name)) {
                reposConfig[repo.name] = {
                    project: teamConfig.project,
                    owner: teamConfig.owner,
                    secrets: teamConfig.secrets
                };
            }
        }
    });
};

/**
 * Create, update or delete the project automation workflow on each repository.
 */
const updateProjectAutomationRepos = async () => {
    // Read the template.
    const workflow = readFileSync(
        `${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/project-automation.yml`, 'utf8'
    );

    // For each company's repository create, update or delete the project automation workflow.
    for ( const repo in reposConfig ) {
        const
            project        = reposConfig[repo].project ?? '',
            owner          = reposConfig[repo].owner ?? '',
            issueManagePat = reposConfig[repo].secrets?.['issue-manage'] ?? '';

        let repoWorkflow = null;

        if (project) {
            repoWorkflow = workflow.replace(/{{{PROJECT_ORG}}}/g, org);
            repoWorkflow = repoWorkflow.replace(/{{{PROJECT_ID}}}/g, project);
            repoWorkflow = repoWorkflow.replace(/{{{PRIMARY_CODEOWNER}}}/g, `"@${owner}"`);
            repoWorkflow = repoWorkflow.replace(/{{{ISSUE_MANAGE_PAT}}}/g, issueManagePat);
        }

        await _createOrUpdateFileContent(
            secrets[reposConfig[repo].secrets?.['workflow-manage'] ?? ''] ?? '',
            repo,
            '.github/workflows/project-automation.yml',
            repoWorkflow
        );

    }
};

/**
 * Create, update or delete the PHPUnit automation workflow on each repository.
 */
const updatePHPUnitAutomationRepos= async () => {
    const
        skipVar = 'ORG_PHPUNIT_SKIP',
        filesToCheck = [ // To check files existence.
            'phpunit.xml',
            '.phpunit.xml.dist',
            'phpunit.xml.dist',
            'phpunit.ruleset.xml',
        ];

    await _createOrUpdateFile(
        `${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/phpunit.yml`,
        '.github/workflows/phpunit.yml',
        'workflow-manage',
        skipVar,
        filesToCheck
    );
};

/**
 * Create, update or delete the PHPCS automation workflow on each repository.
 */
const updatePHPCSAutomationRepos = async () => {

    const
        skipVar = 'ORG_PHPCS_SKIP',
        filesToCheck = [ // To check files existence.
            'phpcs.xml',
            'phpcs.xml.dist',
            'phpcs.ruleset.xml',
        ];

    await _createOrUpdateFile(
        `${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/phpcs.yml`,
        '.github/workflows/phpcs.yml',
        'workflow-manage',
        skipVar,
        filesToCheck
    );
};

/**
 * Check if certain conditions are met to skip a repository.
 *
 * A repo is skipped if any of the following conditions are met:
 * - the repository is not owned and we don't allow the file deletion;
 * - we require to check a skipVar and the repo var is set to require the skip;
 * - we require the existence of some files and they are not present.
 *
 * @param repo    The name of the repository.
 * @param skipVar A repo variable name to check against to determine if the repo should be skipped.
 * @param filesToCheck List of files to check for existence to determine if the repo should be skipped.
 * @returns Whether to skip the repository or not.
 */
const _skipRepo = async (repo, skipVar, filesToCheck) => {
    return (
        // If the repository is not owned and we don't allow the file deletion.
        ( ! reposConfig[repo].owner && !processDeletion ) ||
        // If we require to check a skipVar and the repo var is set to require the skip.
        ( skipVar && await _repoVarRequiresSkip(repo, skipVar) ) ||
        // If we require the existence of some files and they are not present.
        ( filesToCheck && ! await _checkRepoFilesExist(filesToCheck, repo) )
    );
};

/**
 * Check if a repository requires to be skipped based on a action variable.
 *
 * @param repo    The repository to check.
 * @param skipVar The repository skip variable to check.
 * @returns Returns true if the repo needs to be skipped, false otherwise.
 */
const _repoVarRequiresSkip = async (repo, skipVar) => {
    const octokitVarRead = _getOctokitInstance(secrets.CSPF_REPO_VARS_READ_PAT);
    try {
        const {data} = await octokitVarRead.request(
            'GET /repos/{org}/{repo}/actions/variables/{skipVar}',
            {
                org,
                repo,
                skipVar
            }
        );
        return 'true' === (data.value ?? false);
    } catch (error) {
        if (error.status === 403) {
            // Authentication issue.
            console.log(error);
            core.setFailed(error.messages) ;
            throw error;
        }
        // If the variable is not found, we assume the automation is allowed (return false).
        return 404 !== error.status;
    }
};

/**
 * Checks if the specified files exist in the given repository.
 *
 * @param filesToCheck An object containing the files to check.
 * @param repo The name of the repository to check.
 * @returns Returns true if at least one file is found, false after checking all files.
 */
const _checkRepoFilesExist = async (filesToCheck, repo) => {
    const octokitRead = _getOctokitInstance(secrets.CSPF_REPO_READ_PAT);
    for ( const path of filesToCheck ) {
        try {
            await octokitRead.request(
                'GET /repos/{org}/{repo}/contents/{path}',
                {
                    org,
                    repo,
                    path
                }
            );
            return true;
        } catch (error) {
            // Nothing to do.
        }
    }

    return false;
};

/**
 * Update a generic file based on the source file, destination file, secret key, skip variable, and files to check.
 *
 * @param sourceFile The path to the source file.
 * @param destFile The path to the destination file.
 * @param secretKey The secret key, in the repo secrets array, to use to manage the file.
 * @param skipVar A repo variable name to check against to determine if the repo should be skipped.
 * @param filesToCheck List of files to check for existence to determine if the repo should be skipped.
 */
const _createOrUpdateFile = async (sourceFile, destFile, secretKey, skipVar, filesToCheck) => {
    // Read the template.
    const content = readFileSync(
        sourceFile, 'utf8'
    );

    if (!content) {
        return;
    }
    // For each company's repository create, update or delete file.
    for ( const repo in reposConfig ) {
        try {
            if ( ! (await _skipRepo(repo, skipVar, filesToCheck)) ) {
                await _createOrUpdateFileContent(
                    secrets[reposConfig[repo].secrets?.[secretKey] ?? ''] ?? '',
                    repo,
                    destFile,
                    content
                );
            } else {
                console.log(
                    'Skipping %s: The repository is not owned by any team, or misses the required files, or opted out via the %s variable',
                    repo,
                    skipVar
                );
            }
        } catch(error) {
            // Error already down the line.
        }
    }
};

/**
 * Create or update a file on a repository.
 *
 * @param secret The secret to use to create the file.
 * @param repo The repo.
 * @param file The file to create or update (or delete).
 * @param content The content of the file.
 */
const _createOrUpdateFileContent = async (secret, repo, file, content) => {
    if (! content && !processDeletion) {
        console.log(
            'Skipping %s: The repository is not associated to any teams, and workflow deletion is disabled: see process_deletion action\'s parameter.',
            repo
        );
        return;
    }

    const octokitCreate = _getOctokitInstance(
        secret,
        'textCRUD'
    );

    try {
        const _action = content ? 'Creating/Updating' : 'Deleting';
        console.log(
            '%s the %s workflow file on %s',
            _action,
            file.split(/[\\/]/).pop(),
            repo
        );
        await octokitCreate.createOrUpdateTextFile({
            owner: org,
            repo: repo,
            path: file,
            content: content, // When equals to null the workflow file will be deleted.
            message: `${_action} ${file}`
        });
    } catch (error) {
        console.log(error);
        core.setFailed(error.messages) ;
    }
};

/**
 * Retrieves Octokit instance: if not already cached, creates and caches it.
 *
 * @param key Octokit instance key in the cache, usually a token.
 * @param type Can be 'global' or 'textCRUD'. Default is 'global'.
 * @returns Octokit instance or Octokit instance with the plugin `createOrUpdateTextFile`, associated with the given key.
 */
const _getOctokitInstance = (key, type) => {
    type = type || 'global';
    if (
        Object.hasOwn(_octokitInstances,key) &&
        Object.hasOwn(_octokitInstances[key],type)
    ) {
        return _octokitInstances[key][type];
    }

    let octokitInstance = null;
    if ('global' === type) {
        octokitInstance = github.getOctokit(key);
    } else {
        const _Octokit = Octokit.plugin(createOrUpdateTextFile);
        octokitInstance = new _Octokit({auth:key});
    }
    if (!Object.hasOwn(_octokitInstances,key)) {
        _octokitInstances[key]={};
    }
    _octokitInstances[key][type] = octokitInstance;
    return  _octokitInstances[key][type];
};

/**
 * Main.
 */
const main = async () => {
    switch (processDeletion){
    case 'true':
    case true:
    case 1:
    case '1':
        processDeletion = true;
        break;
    default:
        processDeletion = false;
    }

    await buildreposConfig();
    switch (what) {
    case 'project-automation':
        await updateProjectAutomationRepos();
        break;
    case 'phpcs':
        await updatePHPCSAutomationRepos();
        break;
    case 'phpunit':
        await updatePHPUnitAutomationRepos();
        break;
    }
};

main().catch( err => core.setFailed( err.message ) );
