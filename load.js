const core = require("@actions/core");
const github = require("@actions/github");
const path = require("path");

async function run() {
  try {
    // Mock variables for testing. Enables local testing without GitHub Actions
    // process.env.INPUT_INSIGHTS_TOKEN =
    //   "github_pat_..."; // Replace with a valid token
    // process.env.INPUT_COMMIT_TOKEN =
    //   "github_pat_..."; // Replace with a valid token
    // process.env.INPUT_OWNER = "carceneaux";
    // process.env.INPUT_REPOSITORY = "packer-vsphere";
    // process.env.INPUT_ALL_REPOS = "true";
    // process.env.INPUT_HOARD_OWNER = "carceneaux";
    // process.env.INPUT_HOARD_REPO = "repository_insights";
    // process.env.INPUT_BRANCH = "main";
    // process.env.INPUT_DIRECTORY = ".";
    // process.env.INPUT_FORMAT = "json";
    // process.env.GITHUB_REPOSITORY = "owner/repository"; // Required for github.context.repo

    // Initializing inputs and Octokit clients
    const insightsToken = core.getInput("insights_token");
    const commitToken = core.getInput("commit_token") || insightsToken;
    const octokitInsights = github.getOctokit(insightsToken);
    const octokitCommit = github.getOctokit(commitToken);
    const owner = core.getInput("owner") || github.context.repo.owner;
    const allRepos = core.getInput("all_repos") || "false";
    const hoardOwner =
      core.getInput("hoard_owner") || github.context.repo.owner;
    const hoardRepo = core.getInput("hoard_repo") || github.context.repo.repo;
    const branch = core.getInput("branch") || "repository-insights";
    const rootDir = core.getInput("directory") || ".insights";
    const format = (core.getInput("format") || "csv").toLowerCase(); // 'json' or 'csv'
    console.log("Hoard repo set to: " + hoardOwner + "/" + hoardRepo);
    console.log(
      `Sending insights to the '${branch}' branch in the '${rootDir}' directory in the ${format} format.`
    );

    // Variable used to check for duplicate SHAs and if a commit was made
    let refCommitSha, newCommit;

    // Determine repositories to process
    let repo, repos;
    if (allRepos === "true") {
      repos = await getRepos(octokitInsights, owner);
      console.log(`Found ${repos.length} repositories for owner: ${owner}`);
      // console.debug(repos);
    } else {
      repo = core.getInput("repository") || github.context.repo.repo;
      repos = [repo];
    }

    for (const repo of repos) {
      console.log(`Gathering insights for repository: ${owner}/${repo}`);

      const { stargazerCount, commitCount, contributorsCount } =
        await getRepoStats(octokitInsights, owner, repo);

      await ensureBranchExists({
        octokitCommit,
        hoardOwner,
        hoardRepo,
        branch,
      });

      let [insightsFile, insightsCount] = await getInsightsFile({
        octokitCommit,
        hoardOwner,
        hoardRepo,
        owner,
        repo,
        branch,
        rootDir,
        format,
      });

      // Check if the insights file is empty or has less than 13 entries
      if (insightsCount < 13) {
        console.log("Insights file is empty or has less than 13 entries.");
        console.log(
          "Ensuring the previous 14 days of data are present in the insights file."
        );

        let i = 14;
        while (i != 1) {
          // Capture the previous 13 days of data
          const today = new Date();
          today.setDate(today.getDate() - i);
          let yesterdayDateString = today.toISOString().split("T")[0];

          let [yesterdayTraffic, yesterdayClones] = await Promise.all([
            getYesterdayTraffic(
              octokitInsights,
              owner,
              repo,
              yesterdayDateString
            ),
            getYesterdayClones(
              octokitInsights,
              owner,
              repo,
              yesterdayDateString
            ),
          ]);

          insightsFile = await generateFileContent({
            insightsFile,
            stargazerCount,
            commitCount,
            contributorsCount,
            yesterdayTraffic,
            yesterdayClones,
            yesterdayDateString,
            format,
          });

          i--;
        }
      }

      // Normal workflow only capturing the previous day's data
      const yesterdayDateString = getYesterdayDateString();

      const [yesterdayTraffic, yesterdayClones] = await Promise.all([
        getYesterdayTraffic(octokitInsights, owner, repo, yesterdayDateString),
        getYesterdayClones(octokitInsights, owner, repo, yesterdayDateString),
      ]);

      const fileContent = await generateFileContent({
        insightsFile,
        stargazerCount,
        commitCount,
        contributorsCount,
        yesterdayTraffic,
        yesterdayClones,
        yesterdayDateString,
        format,
      });
      // console.debug("File Content:", fileContent);

      [refCommitSha, newCommit] = await commitFileToBranch({
        octokitCommit,
        hoardOwner,
        hoardRepo,
        owner,
        repo,
        branch,
        rootDir,
        fileContent,
        format,
        refCommitSha,
        newCommit,
      });

      logResults({
        stargazerCount,
        commitCount,
        contributorsCount,
        yesterdayTraffic,
        yesterdayClones,
      });

      // No longer setting outputs as the action is focused on committing to the repo
      // setOutputs({
      //   stargazerCount,
      //   commitCount,
      //   contributorsCount,
      //   yesterdayTraffic,
      //   yesterdayClones,
      // });
    }
  } catch (error) {
    console.log(error);
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

function getYesterdayDateString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}

async function getRepos(octokitInsights, owner) {
  // Repositories must belong to either an organization or a user and there is no direct way to know which one it is.
  let response;
  try {
    // Try to get organization repositories
    response = await octokitInsights.rest.repos.listForOrg({
      org: owner,
      type: "public",
    });
  } catch {
    // If it fails, get user repositories
    response = await octokitInsights.rest.repos.listForUser({
      username: owner,
      type: "public",
    });
  }

  return response.data.map((repo) => repo.name);
}

async function getYesterdayTraffic(octokitInsights, owner, repo, dateString) {
  const { data: viewsData } = await octokitInsights.rest.repos.getViews({
    owner,
    repo,
    per: "day",
  });
  return (
    viewsData.views.find(
      (view) => view.timestamp.split("T")[0] === dateString
    ) || { count: 0, uniques: 0 }
  );
}

async function getYesterdayClones(octokitInsights, owner, repo, dateString) {
  const { data: clonesData } = await octokitInsights.rest.repos.getClones({
    owner,
    repo,
    per: "day",
  });
  return (
    clonesData.clones.find(
      (clone) => clone.timestamp.split("T")[0] === dateString
    ) || { count: 0, uniques: 0 }
  );
}

async function getRepoStats(octokitInsights, owner, repo) {
  const query = `
    {
      repository(owner: "${owner}", name: "${repo}") {
        stargazerCount
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 100) {
                totalCount
                nodes {
                  author {
                    user {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

  const response = await octokitInsights.graphql(query);

  const stargazerCount = response.repository.stargazerCount;
  const commitCount =
    response.repository.defaultBranchRef.target.history.totalCount;

  const contributorsSet = new Set(
    response.repository.defaultBranchRef.target.history.nodes
      .filter((node) => node.author.user)
      .map((node) => node.author.user.login)
  );

  return {
    stargazerCount,
    commitCount,
    contributorsCount: contributorsSet.size,
  };
}

function logResults({
  stargazerCount,
  commitCount,
  contributorsCount,
  yesterdayTraffic,
  yesterdayClones,
}) {
  console.log(`Total Stargazers: ${stargazerCount}`);
  console.log(`Total Commits: ${commitCount}`);
  console.log(`Total Contributors: ${contributorsCount}`);
  console.log(`Total Views Yesterday: ${yesterdayTraffic.count}`);
  console.log(`Total Unique Views Yesterday: ${yesterdayTraffic.uniques}`);
  console.log(`Total Clones Yesterday: ${yesterdayClones.count}`);
  console.log(`Total Unique Clones Yesterday: ${yesterdayClones.uniques}`);
}

// function setOutputs({
//   stargazerCount,
//   commitCount,
//   contributorsCount,
//   yesterdayTraffic,
//   yesterdayClones,
// }) {
//   core.setOutput("stargazers", stargazerCount);
//   core.setOutput("commits", commitCount);
//   core.setOutput("contributors", contributorsCount);
//   core.setOutput("traffic_views", yesterdayTraffic.count);
//   core.setOutput("traffic_uniques", yesterdayTraffic.uniques);
//   core.setOutput("clones_count", yesterdayClones.count);
//   core.setOutput("clones_uniques", yesterdayClones.uniques);
// }

async function getInsightsFile({
  octokitCommit,
  hoardOwner,
  hoardRepo,
  owner,
  repo,
  branch,
  rootDir,
  format,
}) {
  const file_path_owner = owner;
  const file_path_repo = repo;
  const dirPath = path.join(rootDir, file_path_owner, file_path_repo);
  const filePath = path.join(dirPath, `insights.${format}`);

  let insightsFile, insightsCount;

  try {
    // Check if the file exists in the repository
    const { data: fileData } = await octokitCommit.rest.repos.getContent({
      owner: hoardOwner,
      repo: hoardRepo,
      path: filePath,
      ref: branch,
    });
    // const existingContent = Base64.decode(fileData.content);
    const existingContent = Buffer.from(fileData.content, "base64").toString(
      "utf-8"
    );

    if (format === "json") {
      insightsFile = existingContent;
      insightsCount = JSON.parse(existingContent).length;
    } else if (format === "csv") {
      const csvLines = existingContent
        .split("\n")
        .filter((line) => line.trim() !== "");
      insightsFile = csvLines.join("\n");
      insightsCount = csvLines.length - 1; // Subtract header line
    } else {
      throw new Error(
        'Unsupported format. Please choose either "json" or "csv".'
      );
    }
  } catch (error) {
    // If file doesn't exist, create an empty file
    console.log(error);
    console.log("Error finding file. Creating a new file.");
    if (format === "json") {
      insightsFile = JSON.stringify([], null, 2);
    } else if (format === "csv") {
      const csvHeaders = [
        "date",
        "stargazers",
        "commits",
        "contributors",
        "traffic_views",
        "traffic_uniques",
        "clones_count",
        "clones_uniques",
      ];
      insightsFile = `${csvHeaders.join(",")}\n`;
    } else {
      throw new Error(
        'Unsupported format. Please choose either "json" or "csv".'
      );
    }
    insightsCount = 0;
  }
  return [insightsFile, insightsCount];
}

async function generateFileContent({
  insightsFile,
  stargazerCount,
  commitCount,
  contributorsCount,
  yesterdayTraffic,
  yesterdayClones,
  yesterdayDateString,
  format,
}) {
  const newEntry = {
    date: yesterdayDateString,
    stargazers: stargazerCount,
    commits: commitCount,
    contributors: contributorsCount,
    traffic_views: yesterdayTraffic.count,
    traffic_uniques: yesterdayTraffic.uniques,
    clones_count: yesterdayClones.count,
    clones_uniques: yesterdayClones.uniques,
  };

  let fileContent;

  try {
    if (format === "json") {
      let existingData = JSON.parse(insightsFile);

      // Check if an entry for today already exists
      const existingEntryIndex = existingData.findIndex(
        (entry) => entry.date === newEntry.date
      );

      if (existingEntryIndex !== -1) {
        // Update the existing entry
        existingData[existingEntryIndex] = newEntry;
      } else {
        // Add the new entry
        existingData.push(newEntry);
      }

      fileContent = JSON.stringify(existingData, null, 2);
    } else if (format === "csv") {
      const csvHeaders = [
        "date",
        "stargazers",
        "commits",
        "contributors",
        "traffic_views",
        "traffic_uniques",
        "clones_count",
        "clones_uniques",
      ];
      const csvLines = insightsFile
        .split("\n")
        .filter((line) => line.trim() !== "");

      // Check if an entry for today already exists
      const existingEntryIndex = csvLines.findIndex((line) =>
        line.startsWith(newEntry.date)
      );

      const csvLine = csvHeaders.map((header) => newEntry[header]).join(",");

      if (existingEntryIndex !== -1) {
        // Update the existing entry
        csvLines[existingEntryIndex] = csvLine;
      } else {
        // Add the new entry
        csvLines.push(csvLine);
      }

      fileContent = csvLines.join("\n");
    }
  } catch (error) {
    throw new Error(`Unable to generate file content: ${error.message}`);
  }
  return fileContent;
}

async function ensureBranchExists({
  octokitCommit,
  hoardOwner,
  hoardRepo,
  branch,
}) {
  try {
    // Check if the branch exists
    await octokitCommit.rest.git.getRef({
      owner: hoardOwner,
      repo: hoardRepo,
      ref: `heads/${branch}`,
    });
    // Branch exists, no action needed
  } catch (error) {
    if (error.status === 404) {
      // Branch does not exist, create it
      const { data: refData } = await octokitCommit.rest.git.getRef({
        owner: hoardOwner,
        repo: hoardRepo,
        ref: "heads/main", // Base branch from which to create the new branch
      });

      const mainSha = refData.object.sha;

      await octokitCommit.rest.git.createRef({
        owner: hoardOwner,
        repo: hoardRepo,
        ref: `refs/heads/${branch}`,
        sha: mainSha,
      });

      console.log(`Branch '${branch}' created from 'main'.`);
    } else {
      throw new Error(`Error checking if branch exists: ${error.message}`);
    }
  }
}

async function commitFileToBranch({
  octokitCommit,
  hoardOwner,
  hoardRepo,
  owner,
  repo,
  branch,
  rootDir,
  fileContent,
  format,
  refCommitSha,
  newCommit,
}) {
  const file_path_owner = owner;
  const file_path_repo = repo;
  const dirPath = path.join(rootDir, file_path_owner, file_path_repo);
  const filePath = path.join(dirPath, `insights.${format}`);
  console.debug(
    `Listing vars before commit: owner=${hoardOwner}, repo=${hoardRepo}, branch=${branch}, filePath=${filePath}`
  );

  // Get the SHA of the branch reference
  let { data: refData } = await octokitCommit.rest.git.getRef({
    owner: hoardOwner,
    repo: hoardRepo,
    ref: `heads/${branch}`,
  });

  let commitSha = refData.object.sha;
  console.debug(
    `Latest commit SHA on branch '${branch}': ${commitSha} || ${refCommitSha}`
  );

  // Wait if the latest commit SHA is the same as the previous commit SHA
  // When making rapid commits, GitHub may not have fully processed the previous commit
  while (refCommitSha === commitSha && newCommit === true) {
    console.log("Duplicate commit SHA detected. Waiting before retrying...");
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 2 seconds
    let { data: refData } = await octokitCommit.rest.git.getRef({
      owner: hoardOwner,
      repo: hoardRepo,
      ref: `heads/${branch}`,
    });
    commitSha = refData.object.sha;
    console.debug(`New latest commit SHA on branch '${branch}': ${commitSha}`);
  }

  refCommitSha = commitSha; // Update the reference commit SHA

  // Get the tree associated with the latest commit
  let { data: commitData } = await octokitCommit.rest.git.getCommit({
    owner: hoardOwner,
    repo: hoardRepo,
    commit_sha: commitSha,
  });

  let treeSha = commitData.tree.sha;

  // Create a new blob with the file content
  const { data: blobData } = await octokitCommit.rest.git.createBlob({
    owner: hoardOwner,
    repo: hoardRepo,
    content: fileContent,
    encoding: "utf-8",
  });

  // Create a new tree that adds the new file
  const { data: newTreeData } = await octokitCommit.rest.git.createTree({
    owner: hoardOwner,
    repo: hoardRepo,
    base_tree: treeSha,
    tree: [
      {
        path: filePath,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      },
    ],
  });
  console.debug(
    `New tree SHA after adding the file: ${newTreeData.sha} || ${treeSha}`
  );

  if (newTreeData.sha === treeSha) {
    console.log("No changes detected. Skipping commit.");
    return [refCommitSha, false]; // Indicate that no new commit was made
  } else {
    // Create a new commit
    const { data: newCommitData } = await octokitCommit.rest.git.createCommit({
      owner: hoardOwner,
      repo: hoardRepo,
      message: `Update insights file for ${file_path_owner}/${file_path_repo}`,
      tree: newTreeData.sha,
      parents: [commitSha],
    });
    console.debug(`New commit SHA: ${newCommitData.sha}`);

    // Update the branch reference to point to the new commit
    let updateRefSuccess = false;
    while (!updateRefSuccess) {
      try {
        await octokitCommit.rest.git.updateRef({
          owner: hoardOwner,
          repo: hoardRepo,
          ref: `heads/${branch}`,
          sha: newCommitData.sha,
        });
        updateRefSuccess = true;
      } catch {
        console.log("Retrying updateRef due to potential race condition...");
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds
      }
    }

    return [refCommitSha, true]; // Indicate that a new commit was made
  }
}

module.exports = {
  run,
};
