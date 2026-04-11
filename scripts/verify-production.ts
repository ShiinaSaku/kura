import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { calculateRank } from "../src/calculateRank.js";
import { kFormatter } from "../src/common/fmt";

const execFileAsync = promisify(execFile);

type RepoNode = {
  name: string;
  owner: {
    login: string;
  };
  stargazerCount?: number;
  stargazers?: {
    totalCount: number;
  };
};

type GraphqlResponse<TData> = {
  data?: TData;
  errors?: Array<{ message?: string }>;
};

type StatsUser = {
  repositories: {
    totalCount: number;
    nodes: Array<{
      name: string;
      stargazers: {
        totalCount: number;
      };
    }>;
  };
  commits: {
    totalCommitContributions: number;
  };
  reviews: {
    totalPullRequestReviewContributions: number;
  };
  repositoriesContributedTo: {
    totalCount: number;
  };
  pullRequests: {
    totalCount: number;
  };
  openIssues: {
    totalCount: number;
  };
  closedIssues: {
    totalCount: number;
  };
  followers: {
    totalCount: number;
  };
};

type ExpectedStats = {
  stars: string;
  commits: string;
  prs: string;
  issues: string;
  contribs: string;
  rank: string;
};

type EndpointCheck = {
  name: string;
  path: string;
};

type RunStats = {
  times: number[];
  okCount: number;
  totalCount: number;
};

type BenchmarkResult = {
  avgMs: number;
  p95Ms: number;
  medianMs: number;
  successRate: number;
  avgRssMb: number;
  peakRssMb: number;
};

type AppBenchmark = {
  appName: string;
  endpoints: Record<string, BenchmarkResult>;
};

const username = process.env.VERIFY_USERNAME ?? "Shiinasaku";
const pinUsername = process.env.VERIFY_PIN_USERNAME ?? "shiinasaku";
const pinRepo = process.env.VERIFY_REPO ?? "github-readme-stats";
const fallbackGistId = "bbfce31e0217a3689c8d961a356cb10d";
const kuraPort = Number(process.env.VERIFY_KURA_PORT ?? 9000);
const ogPort = Number(process.env.VERIFY_OG_PORT ?? 9100);
const sampleCount = Number(process.env.VERIFY_SAMPLES ?? 15);
const targetReductionPct = Number(process.env.VERIFY_TARGET_REDUCTION_PERCENT ?? 80);
const timeoutMs = 20_000;

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN ?? process.env.PAT_1;
}

async function runGhApi(path: string): Promise<unknown> {
  const token = getToken();
  const env = {
    ...process.env,
    ...(token ? { GH_TOKEN: token } : {}),
  };

  const { stdout } = await execFileAsync("gh", ["api", path], {
    env,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout) as unknown;
}

async function runGhGraphql<TData>(query: string): Promise<GraphqlResponse<TData>> {
  const token = getToken();
  const env = {
    ...process.env,
    ...(token ? { GH_TOKEN: token } : {}),
  };

  const { stdout } = await execFileAsync("gh", ["api", "graphql", "-f", `query=${query}`], {
    env,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout) as GraphqlResponse<TData>;
}

async function discoverFixtureGist(targetUser: string): Promise<string | undefined> {
  const data = (await runGhApi(`users/${encodeURIComponent(targetUser)}/gists?per_page=10`)) as Array<{
    id: string;
  }>;

  if (data[0]?.id) {
    return data[0].id;
  }

  const publicData = (await runGhApi("gists/public?per_page=1")) as Array<{
    id: string;
  }>;

  return publicData[0]?.id;
}

function extractSvgValue(svg: string, id: string): string {
  const match = svg.match(new RegExp(`data-testid="${id}"[^>]*>([^<]+)<`));
  if (!match || !match[1]) {
    throw new Error(`Missing ${id} in SVG`);
  }

  return match[1].trim();
}

function parseTitleRank(svg: string): string {
  const match = svg.match(/<title[^>]*>[^<]*Rank:\s*([^<]+)<\/title>/i);
  if (!match || !match[1]) {
    throw new Error("Could not parse rank from SVG title");
  }

  return match[1].trim();
}

function asRenderedNumber(value: number): string {
  return String(kFormatter(value)).trim();
}

async function getExpectedStats(targetUser: string): Promise<ExpectedStats> {
  const query = `query($cursor: String){\n  user(login: \"${targetUser}\"){\n    commits: contributionsCollection { totalCommitContributions }\n    reviews: contributionsCollection { totalPullRequestReviewContributions }\n    repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) { totalCount }\n    pullRequests(first: 1) { totalCount }\n    openIssues: issues(states: OPEN) { totalCount }\n    closedIssues: issues(states: CLOSED) { totalCount }\n    followers { totalCount }\n    repositories(first: 100, ownerAffiliations: OWNER, orderBy: {direction: DESC, field: STARGAZERS}, after: $cursor) {\n      totalCount\n      nodes {\n        name\n        stargazers { totalCount }\n      }\n    }\n  }\n}`;

  const response = await runGhGraphql<{ user?: StatsUser }>(query);
  if (response.errors?.length) {
    throw new Error(response.errors[0]?.message ?? "GraphQL stats query failed");
  }

  const user = response.data?.user;
  if (!user) {
    throw new Error("GraphQL stats query returned no user");
  }

  const starsRaw = user.repositories.nodes.reduce((sum, repo) => sum + repo.stargazers.totalCount, 0);
  const commitsRaw = user.commits.totalCommitContributions;
  const prsRaw = user.pullRequests.totalCount;
  const issuesRaw = user.openIssues.totalCount + user.closedIssues.totalCount;
  const contribsRaw = user.repositoriesContributedTo.totalCount;

  const rank = calculateRank({
    all_commits: false,
    commits: commitsRaw,
    prs: prsRaw,
    issues: issuesRaw,
    reviews: user.reviews.totalPullRequestReviewContributions,
    repos: user.repositories.totalCount,
    stars: starsRaw,
    followers: user.followers.totalCount,
  }).level;

  return {
    stars: asRenderedNumber(starsRaw),
    commits: asRenderedNumber(commitsRaw),
    prs: asRenderedNumber(prsRaw),
    issues: asRenderedNumber(issuesRaw),
    contribs: asRenderedNumber(contribsRaw),
    rank,
  };
}

function startKuraServer(port: number): ChildProcessWithoutNullStreams {
  return spawn("node", ["--env-file=.env", "--import", "tsx", "dev.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function startOgServer(port: number): ChildProcessWithoutNullStreams {
  return spawn("node", ["express.js"], {
    cwd: `${process.cwd()}/github-readme-stats`,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServerReady(baseUrl: string): Promise<void> {
  const start = Date.now();

  while (true) {
    try {
      const response = await fetch(`${baseUrl}/api?username=${encodeURIComponent(username)}`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep trying until timeout.
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Server ${baseUrl} was not ready in ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function getRssMb(pid: number): Promise<number> {
  const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
  const kb = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(kb)) {
    return 0;
  }

  return kb / 1024;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function benchmarkEndpoint(
  baseUrl: string,
  endpoint: EndpointCheck,
  pid: number,
): Promise<BenchmarkResult> {
  const runStats: RunStats = {
    times: [],
    okCount: 0,
    totalCount: 0,
  };
  const rssSamples: number[] = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const start = performance.now();
    const response = await fetch(`${baseUrl}${endpoint.path}`);
    const text = await response.text();
    const elapsed = performance.now() - start;

    runStats.totalCount += 1;
    runStats.times.push(elapsed);

    const contentType = response.headers.get("content-type") ?? "";
    const isSvg = contentType.includes("image/svg+xml") && text.includes("<svg");
    const success = response.ok && isSvg;

    if (success) {
      runStats.okCount += 1;
    }

    rssSamples.push(await getRssMb(pid));
  }

  return {
    avgMs: avg(runStats.times),
    p95Ms: percentile(runStats.times, 95),
    medianMs: percentile(runStats.times, 50),
    successRate: runStats.okCount / Math.max(1, runStats.totalCount),
    avgRssMb: avg(rssSamples),
    peakRssMb: Math.max(0, ...rssSamples),
  };
}

async function benchmarkApp(
  appName: string,
  baseUrl: string,
  endpoints: EndpointCheck[],
  pid: number,
): Promise<AppBenchmark> {
  const results: Record<string, BenchmarkResult> = {};

  for (const endpoint of endpoints) {
    results[endpoint.name] = await benchmarkEndpoint(baseUrl, endpoint, pid);
  }

  return {
    appName,
    endpoints: results,
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatMb(value: number): string {
  return `${value.toFixed(2)}MB`;
}

function reductionPercent(original: number, newer: number): number {
  if (!Number.isFinite(original) || original <= 0) {
    return 0;
  }

  return ((original - newer) / original) * 100;
}

function printBenchmarkComparison(kura: AppBenchmark, og: AppBenchmark): { meetsTarget: boolean } {
  let meetsTarget = true;

  console.log("\nBenchmark Comparison (Kura vs OG)");

  for (const endpointName of Object.keys(kura.endpoints)) {
    const kuraResult = kura.endpoints[endpointName];
    const ogResult = og.endpoints[endpointName];

    if (!ogResult) {
      continue;
    }

    const latencyReduction = reductionPercent(ogResult.medianMs, kuraResult.medianMs);
    const memoryReduction = reductionPercent(ogResult.avgRssMb, kuraResult.avgRssMb);

    const endpointPass = latencyReduction >= targetReductionPct && memoryReduction >= targetReductionPct;
    meetsTarget = meetsTarget && endpointPass;

    console.log(`- ${endpointName}`);
    console.log(
      `  latency median | kura=${formatMs(kuraResult.medianMs)} og=${formatMs(ogResult.medianMs)} reduction=${latencyReduction.toFixed(2)}%`,
    );
    console.log(
      `  memory avg RSS | kura=${formatMb(kuraResult.avgRssMb)} og=${formatMb(ogResult.avgRssMb)} reduction=${memoryReduction.toFixed(2)}%`,
    );
    console.log(
      `  success rate   | kura=${(kuraResult.successRate * 100).toFixed(1)}% og=${(ogResult.successRate * 100).toFixed(1)}%`,
    );
    console.log(`  target(${targetReductionPct}% latency+memory): ${endpointPass ? "PASS" : "FAIL"}`);
  }

  return { meetsTarget };
}

async function assertFunctionalAndAccuracy(baseUrl: string, endpoints: EndpointCheck[], expected: ExpectedStats): Promise<void> {
  for (const endpoint of endpoints) {
    const response = await fetch(`${baseUrl}${endpoint.path}`);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Functional check failed for ${endpoint.name}: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("image/svg+xml") || !text.includes("<svg")) {
      throw new Error(`Functional check failed for ${endpoint.name}: not an SVG response`);
    }
  }

  const statsResponse = await fetch(`${baseUrl}/api?username=${encodeURIComponent(username)}`);
  const statsSvg = await statsResponse.text();

  const actual = {
    stars: extractSvgValue(statsSvg, "stars"),
    commits: extractSvgValue(statsSvg, "commits"),
    prs: extractSvgValue(statsSvg, "prs"),
    issues: extractSvgValue(statsSvg, "issues"),
    contribs: extractSvgValue(statsSvg, "contribs"),
    rank: parseTitleRank(statsSvg),
  };

  const entries = Object.entries(expected) as Array<[keyof ExpectedStats, string]>;
  for (const [key, value] of entries) {
    if (actual[key] !== value) {
      throw new Error(`Accuracy check failed for ${key}: expected=${value} actual=${actual[key]}`);
    }
  }

  console.log("\nFunctional and accuracy checks: PASS");
}

function createEndpoints(gistId: string): EndpointCheck[] {
  return [
    {
      name: "stats",
      path: `/api?username=${encodeURIComponent(username)}`,
    },
    {
      name: "pin",
      path: `/api/pin?username=${encodeURIComponent(pinUsername)}&repo=${encodeURIComponent(pinRepo)}`,
    },
    {
      name: "top-langs",
      path: `/api/top-langs?username=${encodeURIComponent(username)}&layout=compact&langs_count=8`,
    },
    {
      name: "wakatime",
      path: `/api/wakatime?username=${encodeURIComponent(username)}`,
    },
    {
      name: "gist",
      path: `/api/gist?id=${encodeURIComponent(gistId)}`,
    },
  ];
}

async function main(): Promise<void> {
  if (!getToken()) {
    throw new Error("Set GITHUB_TOKEN or PAT_1 before running production verification.");
  }

  const gistId = process.env.VERIFY_GIST_ID ?? (await discoverFixtureGist(username)) ?? fallbackGistId;
  if (!gistId) {
    throw new Error("No usable gist id found. Set VERIFY_GIST_ID and re-run.");
  }

  const endpoints = createEndpoints(gistId);
  const expected = await getExpectedStats(username);

  const kuraServer = startKuraServer(kuraPort);
  const ogServer = startOgServer(ogPort);

  kuraServer.stdout.on("data", (chunk) => process.stdout.write(chunk));
  kuraServer.stderr.on("data", (chunk) => process.stderr.write(chunk));
  ogServer.stdout.on("data", (chunk) => process.stdout.write(chunk));
  ogServer.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const kuraBaseUrl = `http://localhost:${kuraPort}`;
  const ogBaseUrl = `http://localhost:${ogPort}`;

  try {
    await Promise.all([waitForServerReady(kuraBaseUrl), waitForServerReady(ogBaseUrl)]);

    await assertFunctionalAndAccuracy(kuraBaseUrl, endpoints, expected);

    const kuraBench = await benchmarkApp("kura", kuraBaseUrl, endpoints, kuraServer.pid ?? 0);
    const ogBench = await benchmarkApp("og", ogBaseUrl, endpoints, ogServer.pid ?? 0);

    const summary = printBenchmarkComparison(kuraBench, ogBench);

    if (!summary.meetsTarget) {
      console.log(
        `\nOverall verdict: FAIL (did not hit ${targetReductionPct}% reduction on both latency and memory for every endpoint)`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\nOverall verdict: PASS (met ${targetReductionPct}% reduction target)`);
  } finally {
    kuraServer.kill("SIGTERM");
    ogServer.kill("SIGTERM");
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Production verification failed: ${message}`);
  process.exitCode = 1;
});
