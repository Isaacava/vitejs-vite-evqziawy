import {
  useMemo,
  useState,
  type CSSProperties,
} from "react";

type Agent = {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  trustScore: number;
  jobsCompleted: number;
  successRate: number;
  averageDelivery: string;
  startingPrice: number;
  maxPrice: number;
  verified: boolean;
  status:
    | "Available"
    | "Busy"
    | "Offline";
  wallet: string;
};

type MissionTask = {
  id: string;
  title: string;
  role: string;
  description: string;
  budget: number;
  status:
    | "Planned"
    | "Ready"
    | "In Progress"
    | "Completed";
  assignedAgentId?: string;
};

type Mission = {
  id: string;
  title: string;
  goal: string;
  category: string;
  budget: number;
  createdAt: string;
  status:
    | "Planning"
    | "Ready"
    | "In Progress"
    | "Completed";
  tasks: MissionTask[];
};

const MISSION_STORAGE_KEY =
  "bnb_agent_marketplace_missions";

const MISSIONS_UPDATED_EVENT =
  "bnb-missions-updated";

const AGENTS: Agent[] = [
  {
    id: "taskpilot",
    name: "TaskPilot",
    role: "Project Manager",
    description:
      "Coordinates project tasks, dependencies, timelines, and specialist agents.",
    capabilities: [
      "Project planning",
      "Task coordination",
      "Requirement analysis",
      "Team management",
    ],
    trustScore: 97,
    jobsCompleted: 241,
    successRate: 96,
    averageDelivery: "18 min",
    startingPrice: 2,
    maxPrice: 5,
    verified: true,
    status: "Available",
    wallet:
      "0x1111111111111111111111111111111111111111",
  },
  {
    id: "pixelcraft",
    name: "PixelCraft",
    role: "UI/UX Designer",
    description:
      "Designs responsive interfaces, user flows, landing pages, and polished product experiences.",
    capabilities: [
      "UI design",
      "UX research",
      "Responsive design",
      "Design systems",
    ],
    trustScore: 98,
    jobsCompleted: 389,
    successRate: 97,
    averageDelivery: "25 min",
    startingPrice: 3,
    maxPrice: 8,
    verified: true,
    status: "Available",
    wallet:
      "0x2222222222222222222222222222222222222222",
  },
  {
    id: "codeforge",
    name: "CodeForge",
    role: "Developer",
    description:
      "Builds production-ready websites and applications, integrates APIs, and fixes technical issues.",
    capabilities: [
      "Frontend development",
      "Backend development",
      "API integration",
      "Bug fixing",
      "Web applications",
    ],
    trustScore: 99,
    jobsCompleted: 312,
    successRate: 98,
    averageDelivery: "35 min",
    startingPrice: 4,
    maxPrice: 12,
    verified: true,
    status: "Available",
    wallet:
      "0x3333333333333333333333333333333333333333",
  },
  {
    id: "rankpilot",
    name: "RankPilot",
    role: "SEO Specialist",
    description:
      "Optimizes websites for search engines, technical SEO, metadata, structure, and discoverability.",
    capabilities: [
      "Technical SEO",
      "On-page SEO",
      "Keyword research",
      "Schema",
      "Site audits",
    ],
    trustScore: 96,
    jobsCompleted: 204,
    successRate: 95,
    averageDelivery: "22 min",
    startingPrice: 3,
    maxPrice: 9,
    verified: true,
    status: "Available",
    wallet:
      "0x4444444444444444444444444444444444444444",
  },
  {
    id: "verifyai",
    name: "VerifyAI",
    role: "QA Agent",
    description:
      "Tests functionality, responsiveness, accessibility basics, links, forms, and project acceptance criteria.",
    capabilities: [
      "QA testing",
      "Bug detection",
      "Accessibility",
      "Responsive testing",
      "Acceptance testing",
    ],
    trustScore: 99,
    jobsCompleted: 312,
    successRate: 98,
    averageDelivery: "15 min",
    startingPrice: 1,
    maxPrice: 6,
    verified: true,
    status: "Available",
    wallet:
      "0x5555555555555555555555555555555555555555",
  },
];

export default function AgentRegistry() {
  const [
    missions,
    setMissions,
  ] = useState<Mission[]>(
    loadMissions()
  );

  const [
    selectedAgentId,
    setSelectedAgentId,
  ] = useState<string | null>(
    null
  );

  const [
    selectedMissionId,
    setSelectedMissionId,
  ] = useState("");

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] = useState("");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    roleFilter,
    setRoleFilter,
  ] = useState("All");

  const [
    notice,
    setNotice,
  ] = useState("");

  const selectedAgent =
    AGENTS.find(
      (agent) =>
        agent.id ===
        selectedAgentId
    ) ?? null;

  const selectedMission =
    missions.find(
      (mission) =>
        mission.id ===
        selectedMissionId
    ) ?? null;

  const selectedTask =
    selectedMission?.tasks.find(
      (task) =>
        task.id ===
        selectedTaskId
    ) ?? null;

  const filteredAgents =
    useMemo(() => {
      const normalized =
        search
          .trim()
          .toLowerCase();

      return AGENTS.filter(
        (agent) => {
          const matchesSearch =
            normalized.length ===
              0 ||
            [
              agent.name,
              agent.role,
              agent.description,
              ...agent.capabilities,
            ]
              .join(" ")
              .toLowerCase()
              .includes(
                normalized
              );

          const matchesRole =
            roleFilter ===
              "All" ||
            agent.role ===
              roleFilter;

          return (
            matchesSearch &&
            matchesRole
          );
        }
      );
    }, [
      search,
      roleFilter,
    ]);

  function selectAgent(
    agentId: string
  ) {
    setSelectedAgentId(
      agentId
    );

    setNotice("");
  }

  function clearSelection() {
    setSelectedAgentId(
      null
    );

    setSelectedMissionId(
      ""
    );

    setSelectedTaskId(
      ""
    );

    setNotice("");
  }

  function refreshMissions() {
    const latest =
      loadMissions();

    setMissions(
      latest
    );

    if (
      selectedMissionId &&
      !latest.some(
        (mission) =>
          mission.id ===
          selectedMissionId
      )
    ) {
      setSelectedMissionId(
        ""
      );

      setSelectedTaskId(
        ""
      );
    }

    setNotice(
      latest.length > 0
        ? "✅ Missions refreshed."
        : "No missions found."
    );
  }

  function chooseMission(
    missionId: string
  ) {
    const mission =
      missions.find(
        (item) =>
          item.id ===
          missionId
      );

    if (!mission) {
      return;
    }

    setSelectedMissionId(
      mission.id
    );

    setSelectedTaskId(
      mission.tasks[0]?.id ??
        ""
    );

    setNotice("");
  }

  function chooseTask(
    taskId: string
  ) {
    if (
      !selectedMission
    ) {
      return;
    }

    const task =
      selectedMission.tasks.find(
        (item) =>
          item.id ===
          taskId
      );

    if (!task) {
      return;
    }

    setSelectedTaskId(
      task.id
    );

    setNotice("");
  }

  function assignAgent() {
    if (
      !selectedAgent
    ) {
      setNotice(
        "Select an agent first."
      );

      return;
    }

    if (
      !selectedMission
    ) {
      setNotice(
        "Select a mission first."
      );

      return;
    }

    if (
      !selectedTask
    ) {
      setNotice(
        "Select a task first."
      );

      return;
    }

    if (
      selectedTask.budget <
      selectedAgent.startingPrice
    ) {
      setNotice(
        `${selectedAgent.name} starts from ${selectedAgent.startingPrice} U, while this task has a ${selectedTask.budget} U budget.`
      );

      return;
    }

    const updated =
      missions.map(
        (
          mission
        ): Mission => {
          if (
            mission.id !==
            selectedMission.id
          ) {
            return mission;
          }

          return {
            ...mission,

            tasks:
              mission.tasks.map(
                (
                  task
                ): MissionTask =>
                  task.id ===
                  selectedTask.id
                    ? {
                        ...task,

                        assignedAgentId:
                          selectedAgent.id,

                        status:
                          task.status ===
                          "Planned"
                            ? "Ready"
                            : task.status,
                      }
                    : task
              ),
          };
        }
      );

    setMissions(
      updated
    );

    saveMissions(
      updated
    );

    setNotice(
      `✅ ${selectedAgent.name} assigned to ${selectedTask.title}.`
    );
  }

  const assignedAgent =
    selectedTask?.assignedAgentId
      ? AGENTS.find(
          (agent) =>
            agent.id ===
            selectedTask.assignedAgentId
        )
      : undefined;

  return (
    <div
      style={
        styles.page
      }
    >
      <div
        style={
          styles.container
        }
      >
        <section
          style={
            styles.hero
          }
        >
          <div>
            <div
              style={
                styles.eyebrow
              }
            >
              AGENT MARKETPLACE
            </div>

            <h1
              style={
                styles.title
              }
            >
              Find the right agent
            </h1>

            <p
              style={
                styles.subtitle
              }
            >
              Browse specialists, inspect reputation,
              then assign the right provider to each
              mission task.
            </p>
          </div>

          <button
            type="button"
            onClick={
              refreshMissions
            }
            style={
              styles.smallButton
            }
          >
            ↻ Refresh
          </button>
        </section>

        <section
          style={
            styles.filterPanel
          }
        >
          <input
            value={
              search
            }
            onChange={(
              event
            ) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Search agents or capabilities..."
            style={
              styles.searchInput
            }
          />

          <select
            value={
              roleFilter
            }
            onChange={(
              event
            ) =>
              setRoleFilter(
                event.target.value
              )
            }
            style={
              styles.roleSelect
            }
          >
            <option value="All">
              All roles
            </option>

            <option value="Project Manager">
              Project Manager
            </option>

            <option value="UI/UX Designer">
              UI/UX Designer
            </option>

            <option value="Developer">
              Developer
            </option>

            <option value="SEO Specialist">
              SEO Specialist
            </option>

            <option value="QA Agent">
              QA Agent
            </option>
          </select>
        </section>

        <section
          style={
            styles.agentGrid
          }
        >
          {filteredAgents.map(
            (
              agent
            ) => (
              <AgentCard
                key={
                  agent.id
                }
                agent={
                  agent
                }
                selected={
                  selectedAgentId ===
                  agent.id
                }
                onClick={() =>
                  selectAgent(
                    agent.id
                  )
                }
              />
            )
          )}
        </section>

        {selectedAgent && (
          <section
            style={
              styles.detailPanel
            }
          >
            <div
              style={
                styles.detailHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  AGENT PROFILE
                </div>

                <h2
                  style={
                    styles.detailName
                  }
                >
                  {
                    selectedAgent.name
                  }
                </h2>

                <span
                  style={
                    styles.detailRole
                  }
                >
                  {
                    selectedAgent.role
                  }
                </span>
              </div>

              <button
                type="button"
                onClick={
                  clearSelection
                }
                style={
                  styles.smallButton
                }
              >
                Close
              </button>
            </div>

            <p
              style={
                styles.detailDescription
              }
            >
              {
                selectedAgent.description
              }
            </p>

            <div
              style={
                styles.statGrid
              }
            >
              <Stat
                label="Trust Score"
                value={`${selectedAgent.trustScore}/100`}
              />

              <Stat
                label="Jobs Completed"
                value={String(
                  selectedAgent.jobsCompleted
                )}
              />

              <Stat
                label="Success Rate"
                value={`${selectedAgent.successRate}%`}
              />

              <Stat
                label="Avg. Delivery"
                value={
                  selectedAgent.averageDelivery
                }
              />

              <Stat
                label="Price Range"
                value={`${selectedAgent.startingPrice}–${selectedAgent.maxPrice} U`}
              />

              <Stat
                label="Status"
                value={
                  selectedAgent.status
                }
              />
            </div>

            <div
              style={
                styles.capabilitySection
              }
            >
              <div
                style={
                  styles.label
                }
              >
                Capabilities
              </div>

              <div
                style={
                  styles.chips
                }
              >
                {selectedAgent.capabilities.map(
                  (
                    capability
                  ) => (
                    <span
                      key={
                        capability
                      }
                      style={
                        styles.chip
                      }
                    >
                      {
                        capability
                      }
                    </span>
                  )
                )}
              </div>
            </div>

            <section
              style={
                styles.assignPanel
              }
            >
              <div
                style={
                  styles.eyebrow
                }
              >
                ASSIGN TO MISSION
              </div>

              <h3
                style={
                  styles.assignTitle
                }
              >
                Put this agent to work
              </h3>

              <p
                style={
                  styles.assignSubtitle
                }
              >
                Choose the mission and then the exact task.
              </p>

              <div
                style={
                  styles.assignmentSection
                }
              >
                <div
                  style={
                    styles.label
                  }
                >
                  Mission
                </div>

                {missions.length ===
                0 ? (
                  <div
                    style={
                      styles.emptyState
                    }
                  >
                    <strong>
                      No missions available.
                    </strong>

                    <span>
                      Create a mission in the Marketplace
                      first.
                    </span>
                  </div>
                ) : (
                  <div
                    style={
                      styles.selectionGrid
                    }
                  >
                    {missions.map(
                      (
                        mission
                      ) => (
                        <button
                          type="button"
                          key={
                            mission.id
                          }
                          onClick={() =>
                            chooseMission(
                              mission.id
                            )
                          }
                          style={
                            selectedMissionId ===
                            mission.id
                              ? {
                                  ...styles.selectionCard,
                                  ...styles.selectionCardActive,
                                }
                              : styles.selectionCard
                          }
                        >
                          <div
                            style={
                              styles.selectionCardTitle
                            }
                          >
                            {
                              mission.title
                            }
                          </div>

                          <div
                            style={
                              styles.selectionCardMeta
                            }
                          >
                            {
                              mission.category
                            }
                            {" · "}
                            {
                              mission.tasks.length
                            }{" "}
                            tasks
                          </div>

                          <div
                            style={
                              styles.selectionCardBudget
                            }
                          >
                            {
                              mission.budget
                            }{" "}
                            U
                          </div>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              {selectedMission && (
                <div
                  style={
                    styles.assignmentSection
                  }
                >
                  <div
                    style={
                      styles.label
                    }
                  >
                    Task
                  </div>

                  {selectedMission.tasks.length ===
                  0 ? (
                    <div
                      style={
                        styles.emptyState
                      }
                    >
                      This mission has no tasks yet.
                    </div>
                  ) : (
                    <div
                      style={
                        styles.selectionGrid
                      }
                    >
                      {selectedMission.tasks.map(
                        (
                          task
                        ) => {
                          const taskAgent =
                            task.assignedAgentId
                              ? AGENTS.find(
                                  (
                                    agent
                                  ) =>
                                    agent.id ===
                                    task.assignedAgentId
                                )
                              : undefined;

                          return (
                            <button
                              type="button"
                              key={
                                task.id
                              }
                              onClick={() =>
                                chooseTask(
                                  task.id
                                )
                              }
                              style={
                                selectedTaskId ===
                                task.id
                                  ? {
                                      ...styles.selectionCard,
                                      ...styles.selectionCardActive,
                                    }
                                  : styles.selectionCard
                              }
                            >
                              <div
                                style={
                                  styles.selectionCardTitle
                                }
                              >
                                {
                                  task.title
                                }
                              </div>

                              <div
                                style={
                                  styles.selectionCardMeta
                                }
                              >
                                {
                                  task.role
                                }
                                {" · "}
                                {
                                  task.budget
                                }{" "}
                                U
                              </div>

                              <div
                                style={
                                  styles.selectionCardStatus
                                }
                              >
                                {taskAgent
                                  ? `Assigned: ${taskAgent.name}`
                                  : "Unassigned"}
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedTask && (
                <AssignmentPreview
                  agent={
                    selectedAgent
                  }
                  task={
                    selectedTask
                  }
                  existingAgent={
                    assignedAgent
                  }
                />
              )}

              {notice && (
                <div
                  style={
                    notice.startsWith(
                      "✅"
                    )
                      ? styles.success
                      : styles.notice
                  }
                >
                  {
                    notice
                  }
                </div>
              )}

              <button
                type="button"
                onClick={
                  assignAgent
                }
                style={
                  styles.primaryButton
                }
              >
                Assign Agent →
              </button>
            </section>
          </section>
        )}

        <section
          style={
            styles.explainer
          }
        >
          <div
            style={
              styles.eyebrow
            }
          >
            MARKETPLACE FLOW
          </div>

          <h2
            style={
              styles.explainerTitle
            }
          >
            Mission → Agent → Task → ERC-8183
          </h2>

          <div
            style={
              styles.flow
            }
          >
            <FlowStep
              number="01"
              text="User creates mission"
            />

            <FlowStep
              number="02"
              text="Select specialist"
            />

            <FlowStep
              number="03"
              text="Assign task"
            />

            <FlowStep
              number="04"
              text="Create sub-job"
            />

            <FlowStep
              number="05"
              text="Agent delivers"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      style={
        selected
          ? {
              ...styles.agentCard,
              ...styles.agentCardSelected,
            }
          : styles.agentCard
      }
    >
      <div
        style={
          styles.agentCardTop
        }
      >
        <div
          style={
            styles.agentAvatar
          }
        >
          {
            getRoleIcon(
              agent.role
            )
          }
        </div>

        {agent.verified && (
          <span
            style={
              styles.verified
            }
          >
            ✓ Verified
          </span>
        )}
      </div>

      <div
        style={
          styles.agentCardName
        }
      >
        {
          agent.name
        }
      </div>

      <div
        style={
          styles.agentCardRole
        }
      >
        {
          agent.role
        }
      </div>

      <p
        style={
          styles.agentCardDescription
        }
      >
        {
          agent.description
        }
      </p>

      <div
        style={
          styles.agentMiniStats
        }
      >
        <span>
          ⭐{" "}
          {
            agent.trustScore
          }
        </span>

        <span>
          {
            agent.jobsCompleted
          }{" "}
          jobs
        </span>

        <span>
          {
            agent.successRate
          }%
        </span>
      </div>

      <div
        style={
          styles.priceRow
        }
      >
        <span>
          Starting from
        </span>

        <strong>
          {
            agent.startingPrice
          }{" "}
          U
        </strong>
      </div>

      <div
        style={
          styles.viewText
        }
      >
        View agent →
      </div>
    </button>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={
        styles.stat
      }
    >
      <span
        style={
          styles.statLabel
        }
      >
        {
          label
        }
      </span>

      <strong
        style={
          styles.statValue
        }
      >
        {
          value
        }
      </strong>
    </div>
  );
}

function AssignmentPreview({
  agent,
  task,
  existingAgent,
}: {
  agent: Agent;
  task: MissionTask;
  existingAgent?: Agent | null;
}) {
  const matches =
    agentMatchesTask(
      agent,
      task
    );

  const priceFits =
    task.budget >=
    agent.startingPrice;

  return (
    <div
      style={
        matches &&
        priceFits
          ? styles.previewGood
          : styles.previewWarning
      }
    >
      <div
        style={
          styles.previewTitle
        }
      >
        Assignment Preview
      </div>

      <div
        style={
          styles.previewRow
        }
      >
        <span>
          Agent
        </span>

        <strong>
          {
            agent.name
          }
        </strong>
      </div>

      <div
        style={
          styles.previewRow
        }
      >
        <span>
          Task
        </span>

        <strong>
          {
            task.title
          }
        </strong>
      </div>

      <div
        style={
          styles.previewRow
        }
      >
        <span>
          Budget
        </span>

        <strong>
          {
            task.budget
          }{" "}
          U
        </strong>
      </div>

      {existingAgent && (
        <div
          style={
            styles.previewExisting
          }
        >
          Currently assigned to{" "}
          {
            existingAgent.name
          }
          .
        </div>
      )}

      <div
        style={
          styles.matchLine
        }
      >
        {matches
          ? "✓ Role/capability match"
          : "⚠ Review agent capabilities"}

        {" · "}

        {priceFits
          ? "✓ Budget fits"
          : "⚠ Agent price starts above task budget"}
      </div>
    </div>
  );
}

function FlowStep({
  number,
  text,
}: {
  number: string;
  text: string;
}) {
  return (
    <div
      style={
        styles.flowStep
      }
    >
      <span
        style={
          styles.flowNumber
        }
      >
        {
          number
        }
      </span>

      <span>
        {
          text
        }
      </span>
    </div>
  );
}

function agentMatchesTask(
  agent: Agent,
  task: MissionTask
): boolean {
  const role =
    task.role
      .trim()
      .toLowerCase();

  const agentRole =
    agent.role
      .trim()
      .toLowerCase();

  if (
    agentRole.includes(
      role
    ) ||
    role.includes(
      agentRole
    )
  ) {
    return true;
  }

  const haystack =
    [
      agent.role,
      agent.description,
      ...agent.capabilities,
    ]
      .join(" ")
      .toLowerCase();

  return (
    haystack.includes(
      role
    ) ||
    agent.capabilities.some(
      (
        capability
      ) => {
        const normalized =
          capability
            .trim()
            .toLowerCase();

        return (
          role.includes(
            normalized
          ) ||
          normalized.includes(
            role
          )
        );
      }
    )
  );
}

function getRoleIcon(
  role: string
): string {
  const value =
    role.toLowerCase();

  if (
    value.includes(
      "design"
    )
  ) {
    return "🎨";
  }

  if (
    value.includes(
      "developer"
    )
  ) {
    return "💻";
  }

  if (
    value.includes(
      "seo"
    )
  ) {
    return "🔎";
  }

  if (
    value.includes(
      "qa"
    )
  ) {
    return "🧪";
  }

  if (
    value.includes(
      "manager"
    )
  ) {
    return "🧠";
  }

  return "🤖";
}

function loadMissions(): Mission[] {
  try {
    const raw =
      window.localStorage.getItem(
        MISSION_STORAGE_KEY
      );

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(
        raw
      );

    if (
      !Array.isArray(
        parsed
      )
    ) {
      return [];
    }

    return parsed as Mission[];
  } catch {
    return [];
  }
}

function saveMissions(
  missions: Mission[]
) {
  try {
    window.localStorage.setItem(
      MISSION_STORAGE_KEY,
      JSON.stringify(
        missions
      )
    );

    window.dispatchEvent(
      new CustomEvent(
        MISSIONS_UPDATED_EVENT
      )
    );
  } catch (
    error
  ) {
    console.warn(
      "Could not save missions:",
      error
    );
  }
}

const styles: Record<
  string,
  CSSProperties
> = {
  page: {
    minHeight:
      "100vh",
    padding:
      "24px 16px 60px",
    background:
      "#090b0d",
    color:
      "#f1f2ef",
    fontFamily:
      "Inter, system-ui, sans-serif",
  },

  container: {
    maxWidth:
      "1080px",
    margin:
      "0 auto",
  },

  hero: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "16px",
    marginBottom:
      "16px",
  },

  eyebrow: {
    fontSize:
      "10px",
    fontWeight:
      900,
    letterSpacing:
      "0.14em",
    color:
      "#7f878e",
  },

  title: {
    margin:
      "7px 0",
    fontSize:
      "29px",
    letterSpacing:
      "-0.03em",
  },

  subtitle: {
    margin:
      0,
    maxWidth:
      "720px",
    color:
      "#929aa1",
    lineHeight:
      1.6,
    fontSize:
      "14px",
  },

  smallButton: {
    flexShrink:
      0,
    padding:
      "9px 12px",
    borderRadius:
      "9px",
    border:
      "1px solid #343a3f",
    background:
      "#171b1e",
    color:
      "#dce0e3",
    fontWeight:
      700,
    cursor:
      "pointer",
  },

  filterPanel: {
    display:
      "grid",
    gridTemplateColumns:
      "2fr 1fr",
    gap:
      "10px",
    marginBottom:
      "12px",
  },

  searchInput: {
    width:
      "100%",
    boxSizing:
      "border-box",
    padding:
      "13px",
    borderRadius:
      "10px",
    border:
      "1px solid #343a3f",
    background:
      "#0c1012",
    color:
      "#fff",
    outline:
      "none",
    fontSize:
      "14px",
  },

  roleSelect: {
    width:
      "100%",
    boxSizing:
      "border-box",
    padding:
      "13px",
    borderRadius:
      "10px",
    border:
      "1px solid #343a3f",
    background:
      "#0c1012",
    color:
      "#fff",
    outline:
      "none",
  },

  agentGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(250px, 1fr))",
    gap:
      "11px",
  },

  agentCard: {
    width:
      "100%",
    padding:
      "16px",
    textAlign:
      "left",
    border:
      "1px solid #272d32",
    borderRadius:
      "14px",
    background:
      "#111518",
    color:
      "#fff",
    cursor:
      "pointer",
  },

  agentCardSelected: {
    border:
      "1px solid #f0b90b",
  },

  agentCardTop: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
  },

  agentAvatar: {
    width:
      "46px",
    height:
      "46px",
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "11px",
    background:
      "#181d20",
    fontSize:
      "22px",
  },

  verified: {
    padding:
      "5px 7px",
    borderRadius:
      "999px",
    background:
      "#101916",
    color:
      "#7fd3a5",
    fontSize:
      "9px",
    fontWeight:
      900,
  },

  agentCardName: {
    marginTop:
      "14px",
    fontSize:
      "17px",
    fontWeight:
      900,
  },

  agentCardRole: {
    marginTop:
      "3px",
    color:
      "#8b949b",
    fontSize:
      "12px",
  },

  agentCardDescription: {
    minHeight:
      "58px",
    margin:
      "11px 0",
    color:
      "#929aa1",
    fontSize:
      "12px",
    lineHeight:
      1.55,
  },

  agentMiniStats: {
    display:
      "flex",
    flexWrap:
      "wrap",
    gap:
      "10px",
    color:
      "#a7afb5",
    fontSize:
      "11px",
  },

  priceRow: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    marginTop:
      "14px",
    paddingTop:
      "12px",
    borderTop:
      "1px solid #242a2e",
    color:
      "#707980",
    fontSize:
      "11px",
  },

  viewText: {
    marginTop:
      "10px",
    color:
      "#f0b90b",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  detailPanel: {
    marginTop:
      "14px",
    padding:
      "18px",
    border:
      "1px solid #2b3237",
    borderRadius:
      "14px",
    background:
      "#111518",
  },

  detailHeader: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "10px",
  },

  detailName: {
    margin:
      "6px 0 0",
    fontSize:
      "22px",
  },

  detailRole: {
    display:
      "block",
    marginTop:
      "3px",
    color:
      "#858d94",
    fontSize:
      "12px",
  },

  detailDescription: {
    margin:
      "18px 0",
    color:
      "#adb4b9",
    lineHeight:
      1.6,
  },

  statGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(140px, 1fr))",
    gap:
      "8px",
  },

  stat: {
    padding:
      "12px",
    borderRadius:
      "10px",
    background:
      "#0d1012",
    border:
      "1px solid #272d31",
  },

  statLabel: {
    display:
      "block",
    fontSize:
      "10px",
    color:
      "#737b82",
    textTransform:
      "uppercase",
    letterSpacing:
      "0.06em",
  },

  statValue: {
    display:
      "block",
    marginTop:
      "5px",
    fontSize:
      "14px",
  },

  capabilitySection: {
    marginTop:
      "18px",
  },

  label: {
    marginBottom:
      "7px",
    color:
      "#7e878d",
    fontSize:
      "10px",
    fontWeight:
      900,
    textTransform:
      "uppercase",
    letterSpacing:
      "0.08em",
  },

  chips: {
    display:
      "flex",
    flexWrap:
      "wrap",
    gap:
      "7px",
  },

  chip: {
    padding:
      "7px 9px",
    borderRadius:
      "8px",
    background:
      "#191d20",
    border:
      "1px solid #2d3337",
    color:
      "#c3c9cd",
    fontSize:
      "11px",
  },

  assignPanel: {
    marginTop:
      "20px",
    padding:
      "16px",
    borderRadius:
      "12px",
    background:
      "#0d1012",
    border:
      "1px solid #2b3237",
  },

  assignTitle: {
    margin:
      "5px 0 0",
    fontSize:
      "17px",
  },

  assignSubtitle: {
    margin:
      "4px 0 0",
    color:
      "#7c858b",
    fontSize:
      "12px",
  },

  assignmentSection: {
    marginTop:
      "14px",
  },

  selectionGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap:
      "8px",
  },

  selectionCard: {
    position:
      "relative",
    width:
      "100%",
    padding:
      "13px",
    textAlign:
      "left",
    border:
      "1px solid #2b3237",
    borderRadius:
      "10px",
    background:
      "#111518",
    color:
      "#fff",
    cursor:
      "pointer",
  },

  selectionCardActive: {
    border:
      "1px solid #f0b90b",
    background:
      "#171611",
  },

  selectionCardTitle: {
    fontSize:
      "13px",
    fontWeight:
      900,
  },

  selectionCardMeta: {
    marginTop:
      "5px",
    color:
      "#858e95",
    fontSize:
      "11px",
  },

  selectionCardBudget: {
    marginTop:
      "8px",
    color:
      "#f0b90b",
    fontSize:
      "12px",
    fontWeight:
      900,
  },

  selectionCardStatus: {
    marginTop:
      "8px",
    color:
      "#86a990",
    fontSize:
      "10px",
  },

  emptyState: {
    display:
      "grid",
    gap:
      "5px",
    padding:
      "13px",
    border:
      "1px solid #43361f",
    borderRadius:
      "10px",
    background:
      "#171511",
    color:
      "#c8b76f",
    fontSize:
      "12px",
    lineHeight:
      1.5,
  },

  previewGood: {
    marginTop:
      "14px",
    padding:
      "13px",
    borderRadius:
      "10px",
    background:
      "#101916",
    border:
      "1px solid #284737",
    color:
      "#a8d8b9",
  },

  previewWarning: {
    marginTop:
      "14px",
    padding:
      "13px",
    borderRadius:
      "10px",
    background:
      "#191714",
    border:
      "1px solid #453820",
    color:
      "#d0bb70",
  },

  previewExisting: {
    marginTop:
      "7px",
    color:
      "#c7b26c",
    fontSize:
      "11px",
  },

  previewTitle: {
    marginBottom:
      "8px",
    fontWeight:
      900,
    fontSize:
      "12px",
  },

  previewRow: {
    display:
      "flex",
    justifyContent:
      "space-between",
    gap:
      "10px",
    padding:
      "5px 0",
    color:
      "#818a91",
    fontSize:
      "11px",
  },

  matchLine: {
    marginTop:
      "7px",
    color:
      "#9da5aa",
    fontSize:
      "11px",
  },

  primaryButton: {
    width:
      "100%",
    marginTop:
      "12px",
    padding:
      "13px",
    border:
      "none",
    borderRadius:
      "10px",
    background:
      "#f0b90b",
    color:
      "#111",
    fontWeight:
      900,
    cursor:
      "pointer",
  },

  success: {
    marginTop:
      "12px",
    padding:
      "11px",
    borderRadius:
      "9px",
    background:
      "#101916",
    border:
      "1px solid #284737",
    color:
      "#7fd3a4",
    fontSize:
      "12px",
  },

  notice: {
    marginTop:
      "12px",
    padding:
      "11px",
    borderRadius:
      "9px",
    background:
      "#191714",
    border:
      "1px solid #453820",
    color:
      "#d0bb70",
    fontSize:
      "12px",
  },

  explainer: {
    marginTop:
      "18px",
    padding:
      "18px",
    border:
      "1px solid #252b30",
    borderRadius:
      "15px",
    background:
      "#111518",
  },

  explainerTitle: {
    margin:
      "7px 0 18px",
    fontSize:
      "19px",
  },

  flow: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "8px",
    flexWrap:
      "wrap",
  },

  flowStep: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "8px",
    padding:
      "9px",
    borderRadius:
      "9px",
    background:
      "#0d1012",
    border:
      "1px solid #272d32",
    color:
      "#adb4b8",
    fontSize:
      "11px",
  },

  flowNumber: {
    width:
      "22px",
    height:
      "22px",
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "50%",
    background:
      "#f0b90b",
    color:
      "#111",
    fontSize:
      "9px",
    fontWeight:
      900,
  },
};