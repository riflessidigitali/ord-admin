# org-admin
Caseproof GitHub organization administration and management

### Workflows

The [worfkow-sync](./workflow/workflow-sync.yml) workflow, when specific files are updated, runs to sync various files across the company repositories.

### Projects

The [projects.yml](./defs/projects.yml) configuration file describes the organization's projects, the repositories for each project, and their owners.

In the [worfkow-sync](./github/workflow/workflow-sync.yml) a specific job runs when the [projects.yml](./defs/projects.yml), or the [project automation workflow template file](./github/workflow-templates/project-automation.yml), are updated to sync the company repositories on to these changes.
