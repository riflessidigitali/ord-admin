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
    //token = core.getInput('repo-token'),
    secrets = JSON.parse(core.getInput('secrets')),
    org     = core.getInput('org');

/**
 * Create update or delete the project automation workflow on each repository.
 */
const updateRepos = async () => {
    await crudWorkflow();
};

/**
 * Create an array of {repo : { project, owner, secrets }...}.
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
 * Create update or delete the project automation workflow on each repository.
 */
const crudWorkflow = async () => {
    // Read the template.
    const workflow = readFileSync(
        `${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/project-automation.yml`, 'utf8'
    );

    // For each company's repository create, update or delete the project automation workflow.
    for ( const repo in reposConfig ) {
        const
            project       = reposConfig[repo].project ?? '',
            owner         = reposConfig[repo].owner ?? '',
            issueManPat   = reposConfig[repo].secrets?.['issue-manage'] ?? '',
            octokitCreate = _getOctokitInstance(secrets[reposConfig[repo].secrets?.['workflow-manage'] ?? ''] ?? '');

        let repoWorkflow = null;
        if (project) {
            repoWorkflow = workflow.replace(/{{{PROJECT_ORG}}}/g, org);
            repoWorkflow = repoWorkflow.replace(/{{{PROJECT_ID}}}/g, project);
            repoWorkflow = repoWorkflow.replace(/{{{PRIMARY_CODEOWNER}}}/g, `"@${owner}"`);
            repoWorkflow = repoWorkflow.replace(/{{{ISSUE_MAN_PAT}}}/g, issueManPat);
        }

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
 * Retrieves and Octokit instance, and caches it.
 *
 * @param key  key  string Octokit instance key in the cache, usually a token.
 * @param type type string Can be 'global' or 'textCRUD'. Default is 'global'.
 * @returns Octokit or Octokit instance with the plugin createOrUpdateTextFile, associated with the given key.
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
    console.log(key);
    console.log(type);
    _octokitInstances[key][type] = octokitInstance;
    return  _octokitInstances[key][type];
};

/**
 * Main.
 */
const main = async () => {
    await buildreposConfig();
    await updateRepos();
};

main().catch( err => core.setFailed( err.message ) );
