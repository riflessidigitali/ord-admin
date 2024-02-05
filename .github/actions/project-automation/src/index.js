// Require modules.
const
	core = require( '@actions/core' ),
    github = require( '@actions/github' ),
	{ readFileSync } = require( 'fs' ),
	yaml = require( 'js-yaml' ),
    { Octokit } = require("@octokit/core"),
    {
        createOrUpdateTextFile,
        composeCreateOrUpdateTextFile,
    } = require("@octokit/plugin-create-or-update-text-file");

// Setup global vars.
let repos = [],
    repoProjectsOwners = {};

const
	token          = core.getInput( 'repo-token' ),
    octokit        = github.getOctokit( token ),
	_Octokit       = Octokit.plugin(createOrUpdateTextFile),
    octokitCreate  = new _Octokit({auth:token}),
	org            = 'riflessidigitali';

/**
 * Updates repos.
 *
 * @return {void}
 */
const updateRepos = async () => {
    await buildRepoProjectsOwners();
    await copyWorkflow();
};

const pluck = (arr, key) => arr.map(i => i[key]);

const buildRepoProjectsOwners = async () => {

    const projectConfigs = yaml.load(readFileSync(`${ process.env.GITHUB_WORKSPACE }/defs/projects.yml`, 'utf8'));
    console.log('===Project Configs===');
    console.log(projectConfigs);
    console.log('===Project Configs END===');
    repos.forEach((repo) => {
        repoProjectsOwners[repo.name] = repoProjectsOwners[repo.name] || [];
        projectConfigs.forEach((item) => {
            if (item.repositories.includes(repo.name)) {
                repoProjectsOwners[repo.name].push(
                    {
                        project: item.project,
                        owner: item.owner ?? ''
                    }
                );
            }
        });
    });
}

const copyWorkflow = async () => {
    const workflow = readFileSync(`${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/project-automation.yml`, 'utf8');
    for ( repo in repoProjectsOwners ) {
        const
            projects = pluck(repoProjectsOwners[repo], 'project').filter(() => true),
            owners   = pluck(repoProjectsOwners[repo], 'owner').filter(() => true);

        let repoWorkflow = null;
        if (projects.length > 0) {
            repoWorkflow = workflow.replace(/{{{PROJECT_IDS}}}/g, projects.toString().replace(/, *$/, ''));
            if (owners.length > 0) {
                repoWorkflow = repoWorkflow.replace(/{{{PRIMARY_CODEOWNER}}}/g, `"{owners[0].toString()}"`);
            }
        }
        try {
            await octokitCreate.createOrUpdateTextFile({
                owner: org,
                repo: repo,
                path: ".github/workflows/project-automation.yml",
                content: repoWorkflow, // When null the workflow file will be deleted.
                message: "Project Automation Workflow File"
            });
        } catch (error) {
            console.error(error);
        }

    }
    console.log('===Project and Owners===');
    console.log(repoProjectsOwners);
    console.log('===Project and Owners END===');
}

const main = async () => {
    repos = await octokit.paginate('GET /orgs/{org}/repos', {
        org,
    } );

    repos = repos
        .filter( ( { archived, disabled, fork } ) => false === archived && false === disabled /*&& false === fork*/ );
    await updateRepos();

}

main().catch( err => core.setFailed( err.message ) );
