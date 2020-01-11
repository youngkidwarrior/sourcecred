// @flow
/*
 * Command-line utility to fetch GitHub data using the API in
 * ../fetchGithubRepo, and print it to stdout. Useful for testing or
 * saving some data to disk.
 *
 * Usage:
 *
 *   node bin/fetchAndPrintGithubRepo.js REPO_OWNER REPO_NAME [TOKEN]
 *
 * where TOKEN is an optional GitHub authentication token, as generated
 * from https://github.com/settings/tokens/new.
 */

import stringify from "json-stable-stringify";
import tmp from "tmp";

import fetchGithubRepo from "../fetchGithubRepo";
import {makeRepoId} from "../repoId";

function parseArgs() {
  const argv = process.argv.slice(2);
  const fail = () => {
    const invocation = process.argv.slice(0, 2).join(" ");
    throw new Error(`Usage: ${invocation} REPO_OWNER REPO_NAME GITHUB_TOKEN`);
  };
  if (argv.length < 2) {
    fail();
  }
  const [owner, name, githubToken, ...rest] = argv;
  const result = {owner, name, githubToken};
  if (rest.length > 0) {
    fail();
  }
  return result;
}

function main() {
  const args = parseArgs();
  const repoId = makeRepoId(args.owner, args.name);
  const options = {token: args.githubToken, cacheDirectory: tmp.dirSync().name};
  fetchGithubRepo(repoId, options)
    .then((data) => {
      console.log(stringify(data, {space: 4}));
    })
    .catch((errors) => {
      console.error("Errors processing the result:");
      console.error(errors);
      process.exit(1);
    });
}

main();
