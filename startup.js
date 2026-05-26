const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const RUNNER_VERSION = process.env.RUNNER_VERSION || "2.334.0";
const RUNNER_ARCH = "arm64";
const RUNNER_OS = "linux";
const RUNNER_DIR = path.join(__dirname, "actions-runner");
const RUNNER_TARBALL = `actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz`;
const RUNNER_URL = `https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}`;
const EXPECTED_HASH =
  "f44255bd3e80160eb25f71bc83d06ea025f69087488807a584687b3184759f7e4";

const REPO_URL =
  process.env.RUNNER_REPO_URL ||
  "https://github.com/228programmer228-cmyk/ddes1";
const RUNNER_TOKEN = process.env.RUNNER_TOKEN || "BYU7TL44D6SRFKL4N6JXUGTKCWTSS";
const RUNNER_NAME = process.env.RUNNER_NAME || `arm64-runner-${Date.now()}`;
const RUNNER_LABELS = process.env.RUNNER_LABELS || "self-hosted,Linux,ARM64";
const RUNNER_WORK_DIR = process.env.RUNNER_WORK_DIR || "_work";

function log(msg) {
  console.log(`[startup] ${new Date().toISOString()} - ${msg}`);
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading ${url}`);
    const file = fs.createWriteStream(dest);
    const request = (reqUrl) => {
      const mod = reqUrl.startsWith("https") ? https : http;
      mod
        .get(reqUrl, { headers: { "User-Agent": "actions-runner-setup" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            log(`Redirect -> ${res.headers.location}`);
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
    };
    request(url);
  });
}

function verifyHash(filePath, expected) {
  log("Verifying SHA-256 hash...");
  const data = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  if (hash !== expected) {
    throw new Error(
      `Hash mismatch!\n  Expected: ${expected}\n  Got:      ${hash}`
    );
  }
  log("Hash verified OK");
}

async function setupRunner() {
  if (!fs.existsSync(RUNNER_DIR)) {
    fs.mkdirSync(RUNNER_DIR, { recursive: true });
  }

  const tarballPath = path.join(RUNNER_DIR, RUNNER_TARBALL);

  const configPath = path.join(RUNNER_DIR, "config.sh");
  if (!fs.existsSync(configPath)) {
    if (!fs.existsSync(tarballPath)) {
      await download(RUNNER_URL, tarballPath);
      verifyHash(tarballPath, EXPECTED_HASH);
    }

    log("Extracting runner...");
    run(`tar xzf "${tarballPath}" -C "${RUNNER_DIR}"`);
  } else {
    log("Runner already extracted, skipping download");
  }

  if (fs.existsSync(tarballPath)) {
    fs.unlinkSync(tarballPath);
    log("Removed tarball to save disk space");
  }
}

function configureRunner() {
  const credFile = path.join(RUNNER_DIR, ".credentials");
  if (fs.existsSync(credFile)) {
    log("Runner already configured, skipping configuration");
    return;
  }

  if (!RUNNER_TOKEN) {
    throw new Error(
      "RUNNER_TOKEN is required. Set the environment variable RUNNER_TOKEN " +
        "with the token from GitHub Settings > Actions > Runners > Add runner."
    );
  }

  log(`Configuring runner for ${REPO_URL}`);
  run(
    `./config.sh --url "${REPO_URL}" --token "${RUNNER_TOKEN}" ` +
      `--name "${RUNNER_NAME}" --labels "${RUNNER_LABELS}" ` +
      `--work "${RUNNER_WORK_DIR}" --unattended --replace`,
    { cwd: RUNNER_DIR }
  );
  log("Runner configured successfully");
}

function startRunner() {
  log("Starting GitHub Actions runner...");

  const runSh = path.join(RUNNER_DIR, "run.sh");
  const runner = spawn("bash", [runSh], {
    cwd: RUNNER_DIR,
    stdio: "inherit",
    env: { ...process.env },
  });

  runner.on("error", (err) => {
    log(`Runner process error: ${err.message}`);
    process.exit(1);
  });

  runner.on("exit", (code, signal) => {
    if (signal) {
      log(`Runner terminated by signal ${signal}`);
    } else {
      log(`Runner exited with code ${code}`);
    }
    if (code !== 0) {
      log("Restarting runner in 10 seconds...");
      setTimeout(startRunner, 10000);
    }
  });

  process.on("SIGINT", () => {
    log("Received SIGINT, stopping runner...");
    runner.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    log("Received SIGTERM, stopping runner...");
    runner.kill("SIGTERM");
  });
}

async function main() {
  log("=== GitHub Actions Self-Hosted Runner Startup (ARM64) ===");
  log(`Runner version: ${RUNNER_VERSION}`);
  log(`Architecture:   ${RUNNER_ARCH}`);
  log(`Repository:     ${REPO_URL}`);
  log(`Runner name:    ${RUNNER_NAME}`);
  log(`Labels:         ${RUNNER_LABELS}`);

  try {
    await setupRunner();
    configureRunner();
    startRunner();
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  }
}

main();
