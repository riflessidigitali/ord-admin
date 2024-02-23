# org-admin
Caseproof GitHub organization administration and management

### Workflows

The [worfkow-sync](./.github/workflows/workflow-sync.yml) workflow, when specific files are updated, runs to sync various files across the company repositories.

### Teams

The [teams configuration file](./defs/teams-config.yml) describes the organization's teams, the repositories and project for each team, and people involved.

### Projects

In the [worfkow-sync](./.github/workflows/workflow-sync.yml) a specific job runs when the files listed below are updated, to sync the company repositories and the occurred changes:
- [teams configuration file](./defs/teams-config.yml)
- [project automation workflow template file](./.github/workflow-templates/project-automation.yml)
- [worfkow-sync](./.github/workflows/workflow-sync.yml)
