// @flow
// Implementation of `sourcecred init`

import stringify from "json-stable-stringify";
import dedent from "../util/dedent";
import {type RepoId} from "../core/repoId";
import {type Project, projectToJSON, createProject} from "../core/project";
import type {Command, Stdio, ExitCode} from "./command";
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
                           [--discourse DISCOURSE_URL]
                           [--force]
                           [--print]
           sourcecred init --help

    Sets up a new SourceCred instance, by creating a SourceCred project
    configuration, and saving it to 'sourcecred.json' within the current
    directory.

    Zero or more GitHub specs may be provided; each GitHub spec can be of the
    form OWNER/NAME (as in 'torvalds/linux') for loading a single repository,
    or @owner (as in '@torvalds') for loading all repositories owned by a given
    account. If any GitHub specs are present, then the SOURCECRED_GITHUB_TOKEN
    environment variable is required.

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

        --discourse DISCOURSE_URL
            The url of a Discourse server to load.

        --force
            If provided, sourcecred init will overwrite pre-existing
            sourcecred.json files. Otherwise, the command will refuse to
            overwite pre-existing files and fail.

        --print
            If provided, sourcecred init will print the project to stdout
            rather than writing it to sourcecred.json. Mostly used for testing
            purposes, as a SourceCred instance is only valid if the file is
            saved as sourcecred.json. If this flag is set, it supercedes
            --force.

        --help
            Show this help message and exit, as 'sourcecred help init'.

    Environment variables:
        SOURCECRED_GITHUB_TOKEN
            API token for GitHub. This should be a 40-character hex
            string. Required if you provide GitHub specs.

            To generate a token, create a "Personal access token" at
            <https://github.com/settings/tokens>. When loading data for
            public repositories, no special permissions are required.
            For private repositories, the 'repo' scope is required.
    `.trimRight()
  );
}

function die(std: Stdio, message) {
  std.err("fatal: " + message);
  std.err("fatal: run 'sourcecred help init' for help");
  return 1;
}

/**
 * Responsible for CLI argument parsing and control flow (usage or init?).
 */
const initCommand: Command = async (args, std: Stdio) => {
  let withForce = false;
  let printToStdOut = false;
  let discourseUrl: ?string;
  let githubSpecs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--help": {
        usage(std.out);
        return 0;
      }
      case "--github": {
        if (++i >= args.length) return die(std, "--github given without value");
        githubSpecs.push(args[i]);
        break;
      }
      case "--discourse": {
        if (discourseUrl != undefined)
          return die(std, "--discourse given multiple times");
        if (++i >= args.length)
          return die(std, "--discourse given without value");
        discourseUrl = args[i];
        if (!discourseUrl.match(new RegExp("^https?://"))) {
          return die(
            std,
            "invalid discourse url: must start with http:// or https://"
          );
        }
        if (discourseUrl.endsWith("/")) {
          discourseUrl = discourseUrl.slice(0, discourseUrl.length - 1);
        }
        break;
      }
      case "--force": {
        withForce = true;
        break;
      }
      case "--print": {
        printToStdOut = true;
        break;
      }
      default: {
        return die(std, `Unexpected argument ${args[i]}`);
      }
    }
  }

  return await init(std, {
    withForce,
    printToStdOut,
    githubSpecs,
    discourseUrl,
  });
};

type ProjectGenerationOptions = {|
  +withForce: boolean,
  +printToStdOut: boolean,
  +githubSpecs: string[],
  +discourseUrl: ?string,
|};

/**
 * Responsible for the init higher-level logic.
 */
async function init(
  std: Stdio,
  opts: ProjectGenerationOptions
): Promise<ExitCode> {
  const {withForce, printToStdOut, githubSpecs, discourseUrl} = opts;
  try {
    const dir = process.cwd();
    const fileName = "sourcecred.json";
    const projectFilePath = path.join(dir, fileName);

    const fileAlreadyExists = await fs.exists(projectFilePath);
    if (fileAlreadyExists && !(withForce || printToStdOut)) {
      throw new Error(`refusing to overwrite ${fileName} without --force`);
    }

    const githubToken = Common.githubToken();
    const project: Project = await generateProject(
      githubToken,
      githubSpecs,
      discourseUrl
    );

    await outputProject(project, printToStdOut, projectFilePath, std.out);
  } catch (e) {
    return die(std, e.message);
  }
  return 0;
}

/**
 * Responsible for creating a Project instance based on our specs.
 */
async function generateProject(
  githubToken: ?string,
  githubSpecs: string[],
  discourseUrl: ?string
): Promise<Project> {
  if (!githubToken && githubSpecs.length > 0) {
    throw new Error("tried to load GitHub specs, but no GitHub token provided");
  }

  let repoIds: RepoId[] = [];
  for (const spec of githubSpecs) {
    const subproject = await specToProject(spec, NullUtil.get(githubToken));
    repoIds = [...repoIds, ...subproject.repoIds];
  }

  const discourseServer: DiscourseServer | null = discourseUrl
    ? {serverUrl: discourseUrl}
    : null;

  return createProject({
    // the id field is obsolete in the instance system, and will be
    // removed once we fully migrate to sourcecred instances.
    id: "obsolete-id",
    repoIds,
    discourseServer,
  });
}

/**
 * Responsible for outputting a serialized Project.
 */
async function outputProject(
  project: Project,
  shouldPrint: boolean,
  projectFilePath: string,
  print: (string) => void
): Promise<void> {
  const projectJson = projectToJSON(project);
  const stringified = stringify(projectJson, {space: 4});
  if (shouldPrint) {
    print(stringified);
  } else {
    await fs.writeFile(projectFilePath, stringified + "\n");
  }
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
