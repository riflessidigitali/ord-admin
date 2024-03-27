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
    secrets         = JSON.parse(core.getInput('secrets')),
    org             = core.getInput('org');

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
                    secrets: _parseRepoSecrets(teamConfig.secrets, teamConfig, repo),
                };
            }
        }
    });
};

/**
 * Create, update or delete the project automation workflow on each repository.
 */
const updateRepos = async () => {
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

        if (! repoWorkflow && !processDeletion) {
            console.log(
                'Skipping %s: The repository is not associated to any teams, and workflow deletion is disabled: see process_deletion action\'s parameter.',
                repo
            );
            continue;
        }

        const octokitCreate = _getOctokitInstance(
            secrets[reposConfig[repo].secrets?.['workflow-manage'] ?? ''] ?? '',
            'textCRUD'
        );

        try {
            console.log(
                '%s the project-automation.yml workflow file on %s',
                repoWorkflow ? 'Creating/Updating' : 'Deleting',
                repo
            );
            await octokitCreate.createOrUpdateTextFile({
                owner: org,
                repo: repo,
                path: '.github/workflows/project-automation.yml',
                content: repoWorkflow, // When equals to null the workflow file will be deleted.
                message: 'Project Automation Workflow File'
            });
        } catch (error) {
            console.log(error);
            core.setFailed(error.messages) ;
        }
    }
};

/**
 * Parse repository secrets based on team configuration and repository.
 *
 * @param secrets The list of secrets to be parsed.
 * @param teamConfig The team configuration object.
 * @param repo The repository name.
 * @return The parsed list of secrets
 */
const _parseRepoSecrets = (secrets, teamConfig, repo) => {
    /**
     * PATs have a limit of 50 repo.
     * So we add an _N suffix to each secret when the repository
     * index in the team is greater than 49 (array index start at 0).
     * Where N values 1 from 50 to 99, 2 from 100 to 149 and so on...
     */
    const repoIndex = teamConfig.repos.indexOf(repo.name);
    if (repoIndex < 50){
        return secrets;
    }
    for ( const secret in secrets ) {
        secrets[secret] += '_' + (Math.floor(repoIndex/50));
    }
    return secrets
}

/**
 * Retrieves Octokit instance: if not already cached, creates and caches it.
 *
 * @param key  key  string Octokit instance key in the cache, usually a token.
 * @param type type string Can be 'global' or 'textCRUD'. Default is 'global'.
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
    await updateRepos();
};

main().catch( err => core.setFailed( err.message ) );
