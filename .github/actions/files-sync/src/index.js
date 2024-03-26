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

        await _createOrUpdateFile(
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

    // Check files existence
    const filesToCheck = [
        'phpcs.xml',
        '.phpcs.xml.dist',
        'phpcs.xml.dist',
        'phpcs.ruleset.xml',
    ];

    // Read the template.
    const workflow = readFileSync(
        `${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/phpunit.yml`, 'utf8'
    );

    // For each company's repository create, update or delete the phpunit workflow.
    for ( const repo in reposConfig ) {
        // Skip not owned repo.
        if (! reposConfig[repo].owner && !processDeletion) {
            continue;
        }
        if (await _checkRepoFilesExist(filesToCheck, repo)) {
            await _createOrUpdateFile(
                secrets[reposConfig[repo].secrets?.['workflow-manage'] ?? ''] ?? '',
                repo,
                '.github/workflows/phpunit.yml',
                workflow
            );
        } else {
            console.log(
                'Skipping %s: The repository does not contain a phpunit config file',
                repo
            );
        }
    }
};

/**
 * Create, update or delete the PHPCS automation workflow on each repository.
 */
const updatePHPCSAutomationRepos = async () => {

    // Check files existence
    const filesToCheck = [
        'phpcs.xml',
        'phpcs.xml.dist',
        'phpcs.ruleset.xml',
    ];

    // Read the template.
    const workflow = readFileSync(
        `${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/phpcs.yml`, 'utf8'
    );

    // For each company's repository create, update or delete the phpcs workflow.
    for ( const repo in reposConfig ) {
        // Skip not owned repo.
        if (! reposConfig[repo].owner && !processDeletion) {
            continue;
        }

        if (await _checkRepoFilesExist(filesToCheck, repo)) {
            await _createOrUpdateFile(
                secrets[reposConfig[repo].secrets?.['workflow-manage'] ?? ''] ?? '',
                repo,
                '.github/workflows/phpcs.yml',
                workflow
            );
        } else {
            console.log(
                'Skipping %s: The repository does not contain a phpcs config file',
                repo
            );
        }
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
    const octokitRead =  _getOctokitInstance(secrets.CSPF_REPO_READ_PAT);
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
 * Create or update a file on a repository.
 *
 * @param secret string  The secret to use to create the file.
 * @param repo   string  The repo.
 * @param file   string  The file to create or update (or delete).
 * @param content string The content of the file.
 */
const _createOrUpdateFile = async (secret, repo, file, content) => {

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
 * @param key  string Octokit instance key in the cache, usually a token.
 * @param type string Can be 'global' or 'textCRUD'. Default is 'global'.
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
