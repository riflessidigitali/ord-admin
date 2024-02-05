// Require modules.
const
	core = require( '@actions/core' ),
    github = require( '@actions/github' ),
	{readFileSync} = require( 'fs' ),
	yaml = require( 'js-yaml' ),
    {Octokit} = require("@octokit/core"),
    {createOrUpdateTextFile} = require("@octokit/plugin-create-or-update-text-file");

// Setup global vars.
let repos = [],
    repoProjectsOwners = {};

const
	token          = core.getInput( 'repo-token' ),
    octokit        = github.getOctokit( token ),
	_Octokit       = Octokit.plugin(createOrUpdateTextFile),
    octokitCreate  = new _Octokit({auth:token}),
	org            = core.getInput( 'org' );

/**
 * Updates repos.
 *
 * @return {Void}
 */
const updateRepos = async () => {
    await buildRepoProjectsOwners();
    await crudWorkflow();
};

/**
 * Pluck.
 *
 * @param {Array} arr
 * @param {String} key
 * @return {Array}
 */
const pluck = (arr, key) => arr.map(i => i[key]);

/**
 * Create update or delete the project automation workflow on each repository.
 *
 * @return {void}
 */
const buildRepoProjectsOwners = async () => {

    const projectConfigs = yaml.load(readFileSync(`${ process.env.GITHUB_WORKSPACE }/defs/projects.yml`, 'utf8'));
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

/**
 * Create update or delete the project automation workflow on each repository.
 *
 * @return {void}
 */
const crudWorkflow = async () => {
    const workflow = readFileSync(`${ process.env.GITHUB_WORKSPACE }/.github/workflow-templates/project-automation.yml`, 'utf8');
    for ( repo in repoProjectsOwners ) {
        const
            projects = pluck(repoProjectsOwners[repo], 'project').filter(() => true),
            owners   = pluck(repoProjectsOwners[repo], 'owner').filter(() => true);

        let repoWorkflow = null;
        if (projects.length > 0) {
            repoWorkflow = workflow.replace(/{{{PROJECT_ORG}}}/g, org);
            repoWorkflow = repoWorkflow.replace(/{{{PROJECT_ID}}}/g, `${projects[0].toString()}`);
            if (owners.length > 0) {
                repoWorkflow = repoWorkflow.replace(/{{{PRIMARY_CODEOWNER}}}/g, `"${owners[0].toString()}"`);
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
            core.setFailed( error.message ) ;
        }

    }
}

/**
 * Main.
 *
 * @return {void}
 */
const main = async () => {
    repos = await octokit.paginate('GET /orgs/{org}/repos', {
        org,
    } );

    repos = repos
        .filter( ( { archived, disabled, fork } ) => false === archived && false === disabled /*&& false === fork*/ );
    await updateRepos();

}

main().catch( err => core.setFailed( err.message ) );
