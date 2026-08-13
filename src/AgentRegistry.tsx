import {
  useMemo,
  useState,
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
  status: "Available" | "Busy" | "Offline";
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
      "Creates responsive interfaces, design systems, page layouts, and user experiences.",
    capabilities: [
      "UI design",
      "UX design",
      "Responsive design",
      "Design systems",
    ],
    trustScore: 96,
    jobsCompleted: 128,
    successRate: 94,
    averageDelivery: "24 min",
    startingPrice: 3,
    maxPrice: 7,
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
      "Builds production-ready websites and applications and integrates specialist work into the final codebase.",
    capabilities: [
      "React",
      "TypeScript",
      "Node.js",
      "API integration",
      "Deployment",
    ],
    trustScore: 98,
    jobsCompleted: 417,
    successRate: 97,
    averageDelivery: "42 min",
    startingPrice: 5,
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
      "Optimizes websites for discoverability, indexing, structured data, technical SEO, and search-friendly content.",
    capabilities: [
      "Technical SEO",
      "On-page SEO",
      "Structured data",
      "Sitemaps",
      "Schema markup",
    ],
    trustScore: 95,
    jobsCompleted: 183,
    successRate: 93,
    averageDelivery: "21 min",
    startingPrice: 2,
    maxPrice: 6,
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
      "Tests functionality, responsiveness, accessibility basics, links, and project acceptance criteria.",
    capabilities: [
      "QA testing",
      "Bug detection",
      "Accessibility checks",
      "Regression testing",
      "Acceptance testing",
    ],
    trustScore: 99,
    jobsCompleted: 312,
    successRate: 98,
    averageDelivery: "15 min",
    startingPrice: 1,
    maxPrice: 4,
    verified: true,
    status: "Available",
    wallet:
      "0x5555555555555555555555555555555555555555",
  },
];

export default function AgentRegistry() {
  const [
    agents,
  ] = useState<Agent[]>(
    AGENTS
  );

  const [
    missions,
    setMissions,
  ] = useState<Mission[]>(
    loadMissions()
  );

  const [
    selectedAgent,
    setSelectedAgent,
  ] = useState<Agent | null>(
    null
  );

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    roleFilter,
    setRoleFilter,
  ] = useState("All");

  const [
    missionId,
    setMissionId,
  ] = useState(
    missions[0]?.id ??
      ""
  );

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] = useState("");

  const [
    notice,
    setNotice,
  ] = useState("");

  const filteredAgents =
    useMemo(() => {
      const value =
        search
          .trim()
          .toLowerCase();

      return agents.filter(
        (
          agent
        ) => {
          const matchesSearch =
            !value ||
            agent.name
              .toLowerCase()
              .includes(
                value
              ) ||
            agent.role
              .toLowerCase()
              .includes(
                value
              ) ||
            agent.capabilities.some(
              (
                capability
              ) =>
                capability
                  .toLowerCase()
                  .includes(
                    value
                  )
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
      agents,
      search,
      roleFilter,
    ]);

  const selectedMission =
    missions.find(
      (
        mission
      ) =>
        mission.id ===
        missionId
    ) ?? null;

  /*
   * ========================================================
   * ASSIGN AGENT
   * ========================================================
   */

  function assignAgent() {
    if (
      !selectedAgent
    ) {
      setNotice(
        "Choose an agent first."
      );
      return;
    }

    if (
      !selectedMission
    ) {
      setNotice(
        "Choose a mission first."
      );
      return;
    }

    if (
      !selectedTaskId
    ) {
      setNotice(
        "Choose a mission task."
      );
      return;
    }

    const task =
      selectedMission.tasks.find(
        (
          item
        ) =>
          item.id ===
          selectedTaskId
      );

    if (!task) {
      setNotice(
        "Task could not be found."
      );
      return;
    }

    const roleMatches =
      agentMatchesTask(
        selectedAgent,
        task
      );

    if (
      !roleMatches
    ) {
      setNotice(
        `${selectedAgent.name} is not a good role match for "${task.title}".`
      );
      return;
    }

    if (
      task.budget <
      selectedAgent.startingPrice
    ) {
      setNotice(
        `${selectedAgent.name}'s starting price is ${selectedAgent.startingPrice} U, but this task only has ${task.budget} U.`
      );
      return;
    }

    const updatedMissions =
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
                  item
                ): MissionTask =>
                  item.id ===
                  selectedTaskId
                    ? {
                        ...item,
                        assignedAgentId:
                          selectedAgent.id,
                        status:
                          "Ready",
                      }
                    : item
              ),
          };
        }
      );

    setMissions(
      updatedMissions
    );

    saveMissions(
      updatedMissions
    );

    setNotice(
      `✅ ${selectedAgent.name} assigned to "${task.title}".`
    );
  }

  /*
   * ========================================================
   * SELECT AGENT
   * ========================================================
   */

  function openAgent(
    agent: Agent
  ) {
    setSelectedAgent(
      agent
    );

    setNotice("");

    const firstMatchingTask =
      selectedMission?.tasks.find(
        (
          task
        ) =>
          agentMatchesTask(
            agent,
            task
          ) &&
          !task.assignedAgentId
      );

    if (
      firstMatchingTask
    ) {
      setSelectedTaskId(
        firstMatchingTask.id
      );
    } else {
      setSelectedTaskId(
        selectedMission
          ?.tasks[0]?.id ??
          ""
      );
    }
  }

  function clearSelection() {
    setSelectedAgent(
      null
    );

    setNotice("");
  }

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
        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

        <div
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
              AGENT NETWORK
            </div>

            <h1
              style={
                styles.title
              }
            >
              Agent Registry
            </h1>

            <p
              style={
                styles.subtitle
              }
            >
              Find specialist agents, review their
              performance, and assign them to mission
              tasks.
            </p>
          </div>

          <div
            style={
              styles.agentCount
            }
          >
            <strong>
              {
                agents.length
              }
            </strong>

            <span>
              agents
            </span>
          </div>
        </div>

        {/* ================================================= */}
        {/* SEARCH */}
        {/* ================================================= */}

        <div
          style={
            styles.searchPanel
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
            placeholder="Search agents, capabilities, or roles..."
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
            <option>
              All
            </option>

            <option>
              Project Manager
            </option>

            <option>
              UI/UX Designer
            </option>

            <option>
              Developer
            </option>

            <option>
              SEO Specialist
            </option>

            <option>
              QA Agent
            </option>
          </select>
        </div>

        {/* ================================================= */}
        {/* AGENT GRID */}
        {/* ================================================= */}

        <div
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
                  selectedAgent?.id ===
                  agent.id
                }
                onSelect={() =>
                  openAgent(
                    agent
                  )
                }
              />
            )
          )}
        </div>

        {filteredAgents.length ===
          0 && (
          <div
            style={
              styles.empty
            }
          >
            No agents match your search.
          </div>
        )}

        {/* ================================================= */}
        {/* AGENT DETAIL */}
        {/* ================================================= */}

        {selectedAgent && (
          <div
            style={
              styles.detailPanel
            }
          >
            <div
              style={
                styles.detailHeader
              }
            >
              <div
                style={
                  styles.detailIdentity
                }
              >
                <div
                  style={
                    styles.largeAvatar
                  }
                >
                  {
                    getRoleIcon(
                      selectedAgent.role
                    )
                  }
                </div>

                <div>
                  <div
                    style={
                      styles.detailNameRow
                    }
                  >
                    <h2
                      style={
                        styles.detailName
                      }
                    >
                      {
                        selectedAgent.name
                      }
                    </h2>

                    {selectedAgent.verified && (
                      <span
                        style={
                          styles.verified
                        }
                      >
                        ✓ Verified
                      </span>
                    )}
                  </div>

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
              </div>

              <button
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

            {/* ============================================= */}
            {/* ASSIGN */}
            {/* ============================================= */}

            <div
              style={
                styles.assignPanel
              }
            >
              <div>
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
                  Select a mission and the task this agent
                  should handle.
                </p>
              </div>

              <div
                style={
                  styles.assignGrid
                }
              >
                <div>
                  <label
                    style={
                      styles.label
                    }
                  >
                    Mission
                  </label>

                  <select
                    value={
                      missionId
                    }
                    onChange={(
                      event
                    ) => {
                      setMissionId(
                        event.target
                          .value
                      );

                      setSelectedTaskId(
                        ""
                      );
                    }}
                    style={
                      styles.select
                    }
                  >
                    <option value="">
                      Select mission
                    </option>

                    {missions.map(
                      (
                        mission
                      ) => (
                        <option
                          key={
                            mission.id
                          }
                          value={
                            mission.id
                          }
                        >
                          {
                            mission.title
                          }
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label
                    style={
                      styles.label
                    }
                  >
                    Task
                  </label>

                  <select
                    value={
                      selectedTaskId
                    }
                    onChange={(
                      event
                    ) =>
                      setSelectedTaskId(
                        event.target
                          .value
                      )
                    }
                    disabled={
                      !selectedMission
                    }
                    style={
                      styles.select
                    }
                  >
                    <option value="">
                      Select task
                    </option>

                    {selectedMission?.tasks.map(
                      (
                        task
                      ) => (
                        <option
                          key={
                            task.id
                          }
                          value={
                            task.id
                          }
                        >
                          {
                            task.title
                          }{" "}
                          —{" "}
                          {
                            task.budget
                          }{" "}
                          U
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              {selectedMission &&
                selectedTaskId && (
                  <AssignmentPreview
                    agent={
                      selectedAgent
                    }
                    mission={
                      selectedMission
                    }
                    taskId={
                      selectedTaskId
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
                onClick={
                  assignAgent
                }
                style={
                  styles.primaryButton
                }
                disabled={
                  !selectedMission ||
                  !selectedTaskId
                }
              >
                Assign Agent →
              </button>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* HOW IT WORKS */}
        {/* ================================================= */}

        <div
          style={
            styles.explainer
          }
        >
          <div
            style={
              styles.eyebrow
            }
          >
            HOW THIS CONNECTS TO ERC-8183
          </div>

          <h2
            style={
              styles.explainerTitle
            }
          >
            Agent selection happens before the
            blockchain job
          </h2>

          <div
            style={
              styles.flow
            }
          >
            <FlowStep
              number="01"
              text="User creates a mission"
            />

            <FlowArrow />

            <FlowStep
              number="02"
              text="Marketplace finds an agent"
            />

            <FlowArrow />

            <FlowStep
              number="03"
              text="Agent is assigned to task"
            />

            <FlowArrow />

            <FlowStep
              number="04"
              text="ERC-8183 sub-job is created"
            />

            <FlowArrow />

            <FlowStep
              number="05"
              text="Agent works and gets paid"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * ============================================================
 * AGENT CARD
 * ============================================================
 */

function AgentCard({
  agent,
  selected,
  onSelect,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={
        onSelect
      }
      style={{
        ...styles.agentCard,

        ...(selected
          ? styles.agentCardSelected
          : {}),
      }}
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

        <span
          style={
            agent.status ===
            "Available"
              ? styles.available
              : styles.busy
          }
        >
          {
            agent.status
          }
        </span>
      </div>

      <div
        style={
          styles.agentCardName
        }
      >
        {
          agent.name
        }

        {agent.verified && (
          <span
            style={
              styles.verifiedMini
            }
          >
            ✓
          </span>
        )}
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

/*
 * ============================================================
 * STAT
 * ============================================================
 */

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

/*
 * ============================================================
 * ASSIGNMENT PREVIEW
 * ============================================================
 */

function AssignmentPreview({
  agent,
  mission,
  taskId,
}: {
  agent: Agent;
  mission: Mission;
  taskId: string;
}) {
  const task =
    mission.tasks.find(
      (
        item
      ) =>
        item.id ===
        taskId
    );

  if (!task) {
    return null;
  }

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
          Task budget
        </span>

        <strong>
          {
            task.budget
          }{" "}
          U
        </strong>
      </div>

      <div
        style={
          styles.previewRow
        }
      >
        <span>
          Starting price
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
          styles.matchLine
        }
      >
        {matches
          ? "✓ Capability match"
          : "⚠ Capability mismatch"}
      </div>

      <div
        style={
          styles.matchLine
        }
      >
        {priceFits
          ? "✓ Budget fits agent starting price"
          : "⚠ Task budget is below agent starting price"}
      </div>
    </div>
  );
}

/*
 * ============================================================
 * FLOW
 * ============================================================
 */

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
      <div
        style={
          styles.flowNumber
        }
      >
        {
          number
        }
      </div>

      <span>
        {
          text
        }
      </span>
    </div>
  );
}

function FlowArrow() {
  return (
    <span
      style={
        styles.flowArrow
      }
    >
      →
    </span>
  );
}

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function agentMatchesTask(
  agent: Agent,
  task: MissionTask
): boolean {
  const role =
    agent.role.toLowerCase();

  const taskRole =
    task.role.toLowerCase();

  if (
    role ===
    taskRole
  ) {
    return true;
  }

  if (
    taskRole.includes(
      "manager"
    )
  ) {
    return role.includes(
      "manager"
    );
  }

  if (
    taskRole.includes(
      "designer"
    )
  ) {
    return role.includes(
      "designer"
    );
  }

  if (
    taskRole.includes(
      "developer"
    )
  ) {
    return role.includes(
      "developer"
    );
  }

  if (
    taskRole.includes(
      "seo"
    )
  ) {
    return role.includes(
      "seo"
    );
  }

  if (
    taskRole.includes(
      "qa"
    )
  ) {
    return role.includes(
      "qa"
    );
  }

  return false;
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
    ) ||
    value.includes(
      "engineer"
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
    ) ||
    value.includes(
      "quality"
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

    if (
      !raw
    ) {
      return [];
    }

    const parsed =
      JSON.parse(
        raw
      );

    return Array.isArray(
      parsed
    )
      ? parsed
      : [];
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
  } catch (error) {
    console.warn(
      "Could not save missions:",
      error
    );
  }
}

/*
 * ============================================================
 * STYLES
 * ============================================================
 */

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight:
      "100vh",

    padding:
      "26px 16px 60px",

    background:
      "#090b0d",

    color:
      "#f2f2ef",

    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
      "20px",

    marginBottom:
      "20px",
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
      "31px",

    letterSpacing:
      "-0.03em",
  },

  subtitle: {
    margin:
      0,

    maxWidth:
      "720px",

    color:
      "#90989f",

    lineHeight:
      1.6,
  },

  agentCount: {
    minWidth:
      "72px",

    padding:
      "12px",

    borderRadius:
      "12px",

    background:
      "#121619",

    border:
      "1px solid #292f34",

    display:
      "grid",

    justifyItems:
      "center",

    gap:
      "2px",
  },

  agentCountStrong: {
    fontSize:
      "20px",
  },

  searchPanel: {
    display:
      "grid",

    gridTemplateColumns:
      "1fr 220px",

    gap:
      "10px",

    padding:
      "14px",

    marginBottom:
      "14px",

    border:
      "1px solid #252b30",

    borderRadius:
      "14px",

    background:
      "#111518",
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

    transition:
      "transform .15s ease, border-color .15s ease",
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
      "11px",

    fontWeight:
      800,
  },

  available: {
    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#101b15",

    color:
      "#7bc897",

    fontSize:
      "10px",

    fontWeight:
      800,
  },

  busy: {
    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#1d1a13",

    color:
      "#d2bb6b",

    fontSize:
      "10px",

    fontWeight:
      800,
  },

  verified: {
    display:
      "inline-flex",

    alignItems:
      "center",

    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#101a16",

    color:
      "#7ed3a5",

    fontSize:
      "10px",

    fontWeight:
      800,
  },

  verifiedMini: {
    display:
      "inline-grid",

    placeItems:
      "center",

    width:
      "17px",

    height:
      "17px",

    marginLeft:
      "5px",

    borderRadius:
      "50%",

    background:
      "#163126",

    color:
      "#7fd4a6",

    fontSize:
      "10px",
  },

  empty: {
    padding:
      "40px",

    textAlign:
      "center",

    color:
      "#737b82",
  },

  detailPanel: {
    marginTop:
      "14px",

    padding:
      "20px",

    border:
      "1px solid #3b3420",

    borderRadius:
      "15px",

    background:
      "#131412",
  },

  detailHeader: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "flex-start",

    gap:
      "16px",
  },

  detailIdentity: {
    display:
      "flex",

    alignItems:
      "center",

    gap:
      "13px",
  },

  largeAvatar: {
    width:
      "58px",

    height:
      "58px",

    display:
      "grid",

    placeItems:
      "center",

    borderRadius:
      "14px",

    background:
      "#1a1d1e",

    fontSize:
      "27px",
  },

  detailNameRow: {
    display:
      "flex",

    alignItems:
      "center",

    flexWrap:
      "wrap",

    gap:
      "8px",
  },

  detailName: {
    margin:
      0,

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

  assignGrid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",

    gap:
      "10px",

    marginTop:
      "15px",
  },

  select: {
    width:
      "100%",

    boxSizing:
      "border-box",

    padding:
      "11px",

    borderRadius:
      "9px",

    border:
      "1px solid #343a3f",

    background:
      "#0b0f11",

    color:
      "#fff",

    outline:
      "none",
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
  },

  previewWarning: {
    marginTop:
      "14px",

    padding:
      "13px",

    borderRadius:
      "10px",

    background:
      "#191612",

    border:
      "1px solid #49391f",
  },

  previewTitle: {
    marginBottom:
      "8px",

    color:
      "#cbd2d7",

    fontSize:
      "11px",

    fontWeight:
      900,

    textTransform:
      "uppercase",

    letterSpacing:
      "0.08em",
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

  smallButton: {
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

  flowArrow: {
    color:
      "#5e676e",

    fontWeight:
      900,
  },
};
