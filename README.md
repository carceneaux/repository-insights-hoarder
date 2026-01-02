# Github Action: Repository Insights Hoarder

This GitHub Action gathers repository ingsights and "hoards" the results in a JSON or CSV file. GitHub only makes 14 days of insights available, so this action helps to archive them for long-term analysis.

1. Collects statistics on stargazers, commits, contributors, traffic views, and clones using the Github Rest API and GraphQL API.
2. Writes the statistics to a JSON or CSV file under `<directory>/<owner>/<repository>/insights.<format>`.
3. Commits the file to a specified branch in the repository.

### Inputs

| Input Name | Description | Required | Default |
| ------------- | ---------------------------------------------------------------- | -------- | ----------------------------- |
| `insights_token`| GitHub token used to retrieve repository insights. | Yes | |
| `commit_token`| GitHub token used to save insights to storage repository. | No | `insights_token` |
| `owner` | The repository owner or organization where insights will be gathered. | No | `github.context.repo.owner` |
| `repository` | The repository to track insights for. | No | `github.context.repo.repo` |
| `all_repos` | If true, the action will gather insights for all repositories under the specified owner or organization. | No | `false` |
| `hoard_owner` | The repository owner or organization where insights will be hoarded. | No | `github.context.repo.owner` |
| `hoard_repo` | The repository where insights will be hoarded. | No | `github.context.repo.repo` |
| `branch` | The branch to commit the insights file to. | No | `repository-insights` |
| `directory` | The root directory where insights file will be hoarded. | No | `.insights` |
| `format` | The format for the insights file, either 'json' or 'csv'. | No | `csv` |

## 📗 Documentation

### 1. Generate a Github Token

The default GitHub token has insufficient permissions. As such, a nother token must be used with required permissions. If hoarding insights for a single repository, a single token can be used. Otherwise, it's recommended to create two tokens for least privilege access.

1. `insights_token`: Requires read-only permissions. This will be used to retrieve repository insights.
2. `commit_token`: Requires write permissions to the repository where the insights will be hoarded.

To generate the token(s), follow the steps below:

1. Go to Github Settings in the upper right corner,

2. Go to Developer Settings,

3. [Generate a new fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)
    * Click `Generate new token`,
    * Give your token a descriptive name (e.g., `Repository Insights Token`),
    * Select the `Resource owner`
      * A fine-grained token can only interact with object of a single owner or organization. Not to worry as this action supports multiple tokens.
    * Set the `Expiration`
    * Set the `Repository access` set to `All repositories` or `Only select repositories`
      * For the latter, make sure to include the repository where the action is run and any repositories gathering insights from (if different).
          * Repository permissions
              * `Administration`: Read-only *(This is required for `insights_token`.)*
              * `Contents`: Read and write *(This is required for `commit_token`.)*
    * Click `Generate token`
    * Copy the token to your clipboard. You won’t be able to see it again.
4. Add the Token to Your Repository:
    * Navigate to your repository on GitHub.
    * Go to Settings > Secrets and variables > Actions > New repository secret.
    * Name the secret `INSIGHTS_TOKEN` / `COMMIT_TOKEN` (or another name of your choice).
    * Paste the token you copied earlier and click `Add secret`.


### 2. Add a workflow file

To use this action in your repository, create a workflow file (e.g., `.github/workflows/hoard-insights.yml`) with the contents below.

***Note: Do not have multiple workflows writing to the same repository & branch at the same time. Instead, either use a different repository and/or branch.***

This is the minimum configurable parameters to run the job,
and will collect insights daily, on the repository that the workflow sits in,
and store these as a CSV file, on the branch repository-insights, in directory `/.insights/<owner>/<repository>/insights.csv`.

#### 2.1 Simple example

This example assumes you have the following repository secrets defined:

* INSIGHTS_TOKEN
* COMMIT_TOKEN

It will gather insights for the current repository and save the insights to the `repository-insights` branch in the `.insights` directory.

```yaml
name: Collect repository insights

on:
  schedule:
    - cron: '0 0 * * *' # Runs daily at midnight
  workflow_dispatch:

jobs:
  hoard-insights:
    runs-on: ubuntu-latest
    steps:
      - name: Collect insights
        uses: carceneaux/repository-insights-hoarder@v1.0.0
        with:
          insights_token: ${{ secrets.INSIGHTS_TOKEN }}
```

#### 2.2 Example with gathering insights and storing them elsewhere

This example fetches insights from `carceneaux/repository-insights-hoarder` and saves the results in the `storage/storage` repository:

```yaml
name: Collect repository insights

on:
  schedule:
    - cron: '0 0 * * *' # Runs daily at midnight
  workflow_dispatch:

jobs:
  hoard-insights:
    runs-on: ubuntu-latest
    steps:
      - name: Collect insights
        id: collect-insights
        uses: carceneaux/repository-insights-hoarder@v1.0.0
        with:
          insights_token: ${{ secrets.INSIGHTS_TOKEN }}
          commit_token: ${{ secrets.COMMIT_TOKEN }}
          owner: 'carceneaux'
          repository: 'repository-insights-hoarder'
          hoard_owner: 'storage'
          hoard_repo: 'storage'
```

#### 2.3 Example with gathering insights and storing them elsewhere

This example fetches insights from **all public** repositories belonging to `carceneaux` and saves the results in the `storage/storage` repository located in the `main` branch of the root directory in the JSON format:

```yaml
name: Collect repository insights

on:
  schedule:
    - cron: '0 0 * * *' # Runs daily at midnight
  workflow_dispatch:

jobs:
  hoard-insights:
    runs-on: ubuntu-latest
    steps:
      - name: Collect insights
        id: collect-insights
        uses: carceneaux/repository-insights-hoarder@v1.0.0
        with:
          insights_token: ${{ secrets.INSIGHTS_TOKEN }}
          commit_token: ${{ secrets.COMMIT_TOKEN }}
          owner: 'carceneaux'
          all_repos: 'true'
          hoard_owner: 'storage'
          hoard_repo: 'storage'
          branch: 'main'
          directory: '.'
          format: 'json'
```

## ✍ Contributions

We welcome contributions from the community! We encourage you to create [issues](https://github.com/carceneaux/repository-insights-hoarder/issues/new/choose) for Bugs & Feature Requests and submit Pull Requests. For more detailed information, refer to our [Contributing Guide](CONTRIBUTING.md).

## 🤝🏾 License

* [MIT License](LICENSE)

## 🤔 Questions

If you have any questions or something is unclear, please don't hesitate to [create an issue](https://github.com/carceneaux/repository-insights-hoarder/issues/new/choose) and let us know!
