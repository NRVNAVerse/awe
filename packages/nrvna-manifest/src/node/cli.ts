import { formatValidationErrors } from "../validate";
import {
  GENERATED_DIR,
  MANIFESTS_DIR,
  checkGeneratedViews,
  generateFromSource,
  validateSourceManifests,
  writeGeneratedViews,
} from "./manifests-fs";

const USAGE = `Usage: tsx src/node/cli.ts <command>

Commands:
  validate   Validate the source manifests in ${MANIFESTS_DIR}
  generate   Validate, then (re)write derived views into ${GENERATED_DIR}
  check      Validate, then fail if the derived views on disk are stale
`;

function main(argv: string[]): number {
  const command = argv[0];

  switch (command) {
    case "validate": {
      const result = validateSourceManifests();
      if (!result.ok) {
        console.error(formatValidationErrors(result.errors));
        return 1;
      }
      console.log("manifests valid");
      return 0;
    }
    case "generate": {
      const views = generateFromSource();
      const { written, unchanged } = writeGeneratedViews(views);
      for (const name of written) console.log(`wrote ${name}`);
      for (const name of unchanged) console.log(`unchanged ${name}`);
      return 0;
    }
    case "check": {
      const views = generateFromSource();
      const { upToDate, stale } = checkGeneratedViews(views);
      if (!upToDate) {
        console.error(`stale generated files: ${stale.join(", ")} — run "pnpm --filter @nrvnaverse/manifest generate"`);
        return 1;
      }
      console.log("generated files up to date");
      return 0;
    }
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      return command === undefined ? 1 : 0;
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
