import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const projectRoot = `${root}/image-studio`;
const appBundle = `${projectRoot}/build/bin/FHL Studio.app`;
const executable = `${appBundle}/Contents/MacOS/image-studio`;
const plistPath = `${appBundle}/Contents/Info.plist`;

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

const packEnv = {
  VITE_APP_VERSION: process.env.VITE_APP_VERSION ?? "local-macos-release-check",
};

await run("bash", ["scripts/package-local-macos-app.sh"], { cwd: root, env: packEnv });

const frontendBuild = await run("npm", ["run", "build:macos"], { cwd: `${projectRoot}/frontend` });

const goTest = await run("go", ["test", "./..."], {
  cwd: projectRoot,
  env: {
    GOPATH: `${root}/.gopath`,
    GOMODCACHE: `${root}/.gomodcache`,
    GOCACHE: `${root}/.gocache`,
  },
});

const lipoInfo = await run("lipo", ["-info", executable]);
const codesignInfo = await run("codesign", ["-dv", "--verbose=2", appBundle]);
const plistRaw = await readFile(plistPath, "utf8");

const requiredPlistSnippets = [
  "<string>top.fangtangyuan.fhlstudio</string>",
  "<string>FHL Studio</string>",
  "<string>image-studio</string>",
];

for (const snippet of requiredPlistSnippets) {
  if (!plistRaw.includes(snippet)) {
    throw new Error(`Info.plist missing expected snippet: ${snippet}`);
  }
}

if (!/x86_64 arm64/.test(lipoInfo.stdout)) {
  throw new Error(`universal binary verification failed: ${lipoInfo.stdout}`);
}

if (!/Identifier=top\.gptcodex\.imagestudio/.test(codesignInfo.stdout + codesignInfo.stderr)) {
  throw new Error(`codesign output missing expected bundle identifier:\n${codesignInfo.stdout}\n${codesignInfo.stderr}`);
}

console.log(JSON.stringify({
  packageScript: "ok",
  frontendBuild: /built in/.test(frontendBuild.stdout),
  goTest: /ok\s+image-studio\/backend/.test(goTest.stdout) || /\[no test files\]/.test(goTest.stdout),
  universalBinary: lipoInfo.stdout.trim(),
  codesign: (codesignInfo.stdout + codesignInfo.stderr).trim(),
  plistVerified: true,
}, null, 2));
