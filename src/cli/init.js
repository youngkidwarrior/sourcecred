// @flow
// Implementation of `sourcecred init`

import dedent from "../util/dedent";
import {type RepoId} from "../core/repoId";
import {type Project, projectToJSON} from "../core/project";
import type {Command} from "./command";
import * as Common from "./common";
import fs from "fs-extra";
import process from "process";
import path from "path";
import {type DiscourseServer} from "../plugins/discourse/loadDiscourse";
import {specToProject} from "../plugins/github/specToProject";
import * as NullUtil from "../util/null";

function usage(print: (string) => void): void {
  print(
    dedent`\
    usage: sourcecred init [--github GITHUB_SPEC [...]]
                           [--discourse-url DISCOURSE_URL]
                           [--force]
           sourcecred init --help

    Sets up a new SourceCred instance, by creating a SourceCred project
    configuration, and saving it to 'sourcecred.json' within the current
    directory.

    Zero or more github specs may be provided; each GitHub spec can be of the
    form OWNER/NAME (as in 'torvalds/linux') for loading a single repository,
    or @owner (as in '@torvalds') for loading all repositories owned by a given
    account.

    A discourse url may be provided. The discourse url must be the full url of
    a valid Discourse server, as in 'https://discourse.sourcecred.io'.

    All of the GitHub specs, and the Discourse specification (if it exists)
    will be combined into a single project, which is written to
    sourcecred.json. The file may be manually modified to activate other
    advanced features, such as identity map resolution.

    Arguments:
        --github GITHUB_SPEC
            A specification (in form 'OWNER/NAME' or '@OWNER') of GitHub
            repositories to load.

        --discourse-url DISCOURSE_URL
            The url of a Discourse server to load.

        --force
            If provided, sourcecred init will overwrite pre-existing
            sourcecred.json files.

        --print
            If provided, sourcecred init will print the project to stdout
            rather than writing it to sourcecred.json.

        --help
            Show this help message and exit, as 'sourcecred help init'.

    Environment variables:
        SOURCECRED_GITHUB_TOKEN
            API token for GitHub. This should be a 40-character hex
            string. Required if you want to load whole GitHub orgs.

            To generate a token, create a "Personal access token" at
            <https://github.com/settings/tokens>. When loading data for
            public repositories, no special permissions are required.
            For private repositories, the 'repo' scope is required.
    `.trimRight()
  );
}

function die(std, message) {
  std.err("fatal: " + message);
  std.err("fatal: run 'sourcecred help init' for help");
  return 1;
}

const initCommand: Command = async (args, std) => {
  const maybeParsedArgs = parseArguments(args);
  if (maybeParsedArguments.type === "FAILURE") {
    return die(maybeParsedArgs.failure);
  }
  const parsedArgs = maybeParsedArgs.result;
  if (parsedArgs.wantsHelp) {
    usage(std.out);
    return 0;
  }

  const maybeProject = await generateProject(parsedArgs, Common.githubToken());
  if (maybeProject.type === "FAILURE") {
    return die(maybeProject.failure);
  }
  const project = maybeProject.result;

  const dir = process.cwd();
  const projectFilePath = path.join(dir, "sourcecred.json");
  if ((await fs.exists(projectFilePath)) && !withForce) {
    return die(std, `refusing to overwrite sourcecred.json without --force`);
  }
  const basename = path.basename(dir);

  const githubToken = Common.githubToken();
  if (githubToken == null && githubSpecs.length > 0) {
    return die(
      std,
      "tried to load GitHub specs, but no GitHub token provided."
    );
  }
  let repoIds: RepoId[] = [];
  for (const spec of githubSpecs) {
    const subproject = await specToProject(spec, NullUtil.get(githubToken));
    repoIds = [...repoIds, ...subproject.repoIds];
  }

  const discourseServer: DiscourseServer | null = discourseUrl
    ? {serverUrl: discourseUrl}
    : null;
  const project: Project = {
    id: basename,
    repoIds,
    discourseServer,
    identities: [],
  };

  const projectJson = projectToJSON(project);
  await fs.writeFile(projectFilePath, JSON.stringify(projectJson, null, 2));

  std.out("Wrote project file to 'sourcecred.json'");

  return 0;
};

// 1. Parse arguments

type ResultOrFailureMessage<T> =
  | {|+type: "RESULT", +result: T|}
  | {|+type: "FAILURE", +message: string|};

type ParsedArguments = {|
  +githubSpecs: $ReadOnlyArray<string>,
  +discourseUrl: string | null,
  +useForce: boolean,
  +wantsHelp: boolean,
|};

export function parseArguments(args): ResultOrFailureMessage<ParsedArguments> {
  let withForce = false;
  let discourseUrl: string | null = null;
  let githubSpecs: string[] = [];
  let wantsHelp = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--help": {
        wantsHelp = true;
        break;
      }
      case "--github": {
        if (++i >= args.length)
          return {type: "FAILURE", message: "--github given without value"};
        githubSpecs.push(args[i]);
        break;
      }
      case "--discourse": {
        if (discourseUrl != undefined)
          return {type: "FAILURE", message: "--discourse given multiple times"};
        if (++i >= args.length)
          return {
            type: "FAILURE",
            message: "'--discourse' given without value",
          };
        discourseUrl = args[i];
        break;
      }
      case "--force": {
        withForce = true;
        break;
      }
      default: {
        return {type: "FAILURE", message: `Unexpected argument ${args[i]}`};
      }
    }
  }
  return {
    type: "RESULT",
    result: {withForce, discourseUrl, githubSpecs, wantsHelp},
  };
}

export const help: Command = async (args, std) => {
  if (args.length === 0) {
    usage(std.out);
    return 0;
  } else {
    usage(std.err);
    return 1;
  }
};

export default initCommand;
