import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextRequest, NextResponse } from 'next/server';
import { parseGitHubIssueUrl } from '@/lib/github-task-import';

const execFileAsync = promisify(execFile);

interface GitHubFieldValueNode {
  text?: string | null;
  name?: string | null;
  number?: number | null;
  date?: string | null;
  field?: {
    name?: string | null;
  } | null;
}

interface GitHubProjectItemNode {
  id?: string | null;
  project?: {
    title?: string | null;
    number?: number | null;
  } | null;
  fieldValues?: {
    nodes?: GitHubFieldValueNode[];
  } | null;
}

function getGitHubToken(): string | undefined {
  return process.env.GH_GENERAL_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined;
}

function buildGitHubCliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const token = getGitHubToken();

  if (token) {
    env.GH_TOKEN ??= token;
    env.GITHUB_TOKEN ??= token;
  }

  return env;
}

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('gh', args, {
    env: buildGitHubCliEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout) as T;
}

function normalizeProjectFields(
  owner: string,
  repo: string,
  projectItem: GitHubProjectItemNode
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Repo: `${owner}/${repo}`,
    Project: projectItem.project?.title ?? '',
    'Project Item ID': projectItem.id ?? '',
  };

  for (const fieldValue of projectItem.fieldValues?.nodes ?? []) {
    const fieldName = fieldValue.field?.name?.trim();
    if (!fieldName) {
      continue;
    }

    const value = fieldValue.text
      ?? fieldValue.name
      ?? fieldValue.date
      ?? (typeof fieldValue.number === 'number' ? String(fieldValue.number) : undefined);

    if (value) {
      fields[fieldName] = value;
    }
  }

  return fields;
}

const ISSUE_PROJECT_ITEMS_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 20) {
        nodes {
          id
          project {
            title
            number
          }
          fieldValues(first: 50) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`.trim();

export async function POST(request: NextRequest) {
  try {
    if (!getGitHubToken()) {
      return NextResponse.json({ error: 'Missing GH_GENERAL_TOKEN or GITHUB_TOKEN' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const source = typeof body.issue_url === 'string' ? parseGitHubIssueUrl(body.issue_url) : undefined;
    const repoOwner = source?.repo_owner ?? body.repo_owner;
    const repoName = source?.repo_name ?? body.repo_name;
    const issueNumber = source?.issue_number ?? body.issue_number;

    if (!repoOwner || !repoName || !issueNumber) {
      return NextResponse.json({ error: 'A GitHub issue URL or repo owner/name + issue number is required' }, { status: 400 });
    }

    const issue = await ghJson<{
      number: number;
      title: string;
      body?: string;
      html_url: string;
      labels?: Array<{ name: string }>;
      pull_request?: unknown;
    }>(['api', `repos/${repoOwner}/${repoName}/issues/${issueNumber}`]);

    if (issue.pull_request) {
      return NextResponse.json({ error: 'Pull requests are not supported here; use a GitHub issue URL' }, { status: 400 });
    }

    const projectData = await ghJson<{
      data?: {
        repository?: {
          issue?: {
            projectItems?: {
              nodes?: GitHubProjectItemNode[];
            };
          };
        };
      };
    }>([
      'api',
      'graphql',
      '--raw-field',
      `query=${ISSUE_PROJECT_ITEMS_QUERY}`,
      '-f',
      `owner=${repoOwner}`,
      '-f',
      `repo=${repoName}`,
      '-F',
      `number=${issueNumber}`,
    ]);

    const projectItems = (projectData.data?.repository?.issue?.projectItems?.nodes ?? [])
      .filter((item): item is GitHubProjectItemNode => Boolean(item?.id))
      .map((item) => ({
        id: item.id as string,
        project_title: item.project?.title ?? 'Unnamed Project',
        project_number: item.project?.number ?? undefined,
        project_fields: normalizeProjectFields(repoOwner, repoName, item),
      }));

    return NextResponse.json({
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        html_url: issue.html_url,
        labels: issue.labels ?? [],
      },
      repository: {
        full_name: `${repoOwner}/${repoName}`,
        name: repoName,
        owner: { login: repoOwner },
      },
      project_items: projectItems,
      default_project_item_id: projectItems[0]?.id,
    });
  } catch (error) {
    console.error('Failed to load GitHub issue:', error);
    return NextResponse.json({ error: 'Failed to load GitHub issue' }, { status: 500 });
  }
}
