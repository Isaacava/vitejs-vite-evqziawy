import {
  useMemo,
  useState,
} from "react";

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

const STORAGE_KEY =
  "bnb_agent_marketplace_missions";

const DEFAULT_BUDGET = 20;

export default function MissionPlanner() {
  const [goal, setGoal] =
    useState("");

  const [budget, setBudget] =
    useState(
      DEFAULT_BUDGET.toString()
    );

  const [missionTitle, setMissionTitle] =
    useState("");

  const [category, setCategory] =
    useState(
      "Website Development"
    );

  const [tasks, setTasks] =
    useState<MissionTask[]>([]);

  const [missions, setMissions] =
    useState<Mission[]>(
      loadMissions()
    );

  const [selectedMission, setSelectedMission] =
    useState<Mission | null>(
      null
    );

  const [step, setStep] =
    useState<
      "create" | "review"
    >("create");

  const [
    plannerMessage,
    setPlannerMessage,
  ] = useState("");

  /*
   * ========================================================
   * GENERATE TEAM
   * ========================================================
   */

  function generateTeam() {
    setPlannerMessage("");

    const numericBudget =
      Number(
        budget
      );

    if (
      !goal.trim()
    ) {
      setPlannerMessage(
        "Describe what you want the agents to accomplish."
      );

      return;
    }

    if (
      !Number.isFinite(
        numericBudget
      ) ||
      numericBudget <= 0
    ) {
      setPlannerMessage(
        "Enter a valid project budget greater than 0 U."
      );

      return;
    }

    const detectedCategory =
      detectCategory(
        goal
      );

    setCategory(
      detectedCategory
    );

    setMissionTitle(
      createMissionTitle(
        goal,
        detectedCategory
      )
    );

    const generatedTasks =
      generateTasks(
        goal,
        numericBudget,
        detectedCategory
      );

    setTasks(
      generatedTasks
    );

    setPlannerMessage(
      "Team plan generated successfully."
    );

    setStep(
      "review"
    );
  }

  /*
   * ========================================================
   * REGENERATE
   * ========================================================
   */

  function regenerateTeam() {
    setPlannerMessage("");

    const numericBudget =
      Number(
        budget
      );

    if (
      !Number.isFinite(
        numericBudget
      ) ||
      numericBudget <= 0
    ) {
      setPlannerMessage(
        "Enter a valid project budget first."
      );

      return;
    }

    const generatedTasks =
      generateTasks(
        goal,
        numericBudget,
        category
      );

    setTasks(
      generatedTasks
    );

    setPlannerMessage(
      "Team allocation regenerated."
    );
  }

  /*
   * ========================================================
   * CREATE MISSION
   * ========================================================
   */

  function startMission() {
    if (
      !goal.trim()
    ) {
      setPlannerMessage(
        "Mission goal is required."
      );

      return;
    }

    if (
      tasks.length === 0
    ) {
      setPlannerMessage(
        "Generate a team before starting the mission."
      );

      return;
    }

    const numericBudget =
      Number(
        budget
      );

    const totalAllocated =
      tasks.reduce(
        (
          total,
          task
        ) =>
          total +
          task.budget,
        0
      );

    if (
      Math.abs(
        totalAllocated -
          numericBudget
      ) >
      0.000001
    ) {
      setPlannerMessage(
        "The task allocation does not match the project budget."
      );

      return;
    }

    const mission: Mission =
      {
        id:
          createMissionId(),

        title:
          missionTitle.trim() ||
          createMissionTitle(
            goal,
            category
          ),

        goal:
          goal.trim(),

        category,

        budget:
          numericBudget,

        createdAt:
          new Date().toISOString(),

        status:
          "Planning",

        tasks:
          tasks.map(
            (
              task
            ) => ({
              ...task,
              status:
                "Planned",
            })
          ),
      };

    const updatedMissions = [
      mission,
      ...missions,
    ];

    setMissions(
      updatedMissions
    );

    saveMissions(
      updatedMissions
    );

    setSelectedMission(
      mission
    );

    setPlannerMessage("");

    setStep(
      "create"
    );
  }

  /*
   * ========================================================
   * OPEN MISSION
   * ========================================================
   */

  function openMission(
    mission: Mission
  ) {
    setSelectedMission(
      mission
    );

    setStep(
      "create"
    );
  }

  /*
   * ========================================================
   * UPDATE TASK STATUS
   * ========================================================
   *
   * Development-only control for now.
   * Later these updates will come from
   * the actual agent/job system.
   */

  function updateTaskStatus(
    missionId: string,
    taskId: string,
    newStatus: MissionTask["status"]
  ) {
    const updated =
      missions.map(
        (
          mission
        ) => {
          if (
            mission.id !==
            missionId
          ) {
            return mission;
          }

          const updatedTasks =
            mission.tasks.map(
              (
                task
              ) =>
                task.id ===
                taskId
                  ? {
                      ...task,
                      status:
                        newStatus,
                    }
                  : task
            );

          const allCompleted =
            updatedTasks.every(
              (
                task
              ) =>
                task.status ===
                "Completed"
            );

          const anyStarted =
            updatedTasks.some(
              (
                task
              ) =>
                task.status ===
                  "In Progress" ||
                task.status ===
                  "Completed"
            );

          return {
            ...mission,

            status:
              allCompleted
                ? "Completed"
                : anyStarted
                ? "In Progress"
                : "Planning",

            tasks:
              updatedTasks,
          };
        }
      );

    setMissions(
      updated
    );

    saveMissions(
      updated
    );

    const refreshed =
      updated.find(
        (
          mission
        ) =>
          mission.id ===
          missionId
      ) ??
      null;

    setSelectedMission(
      refreshed
    );
  }

  /*
   * ========================================================
   * CALCULATIONS
   * ========================================================
   */

  const totalAllocated =
    useMemo(
      () =>
        tasks.reduce(
          (
            total,
            task
          ) =>
            total +
            task.budget,
          0
        ),
      [tasks]
    );

  const enteredBudget =
    Number(
      budget
    ) || 0;

  const allocationMatches =
    tasks.length >
      0 &&
    Math.abs(
      totalAllocated -
        enteredBudget
    ) <
      0.000001;

  /*
   * ========================================================
   * RENDER
   * ========================================================
   */

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
              AGENT MARKETPLACE
            </div>

            <h1
              style={
                styles.title
              }
            >
              Mission Planner
            </h1>

            <p
              style={
                styles.subtitle
              }
            >
              Describe the outcome you want.
              We'll turn it into a coordinated
              team of specialist agents.
            </p>
          </div>

          <div
            style={
              styles.heroBadge
            }
          >
            BSC
            <br />
            TESTNET
          </div>
        </div>

        {/* ================================================= */}
        {/* ACTIVE MISSION */}
        {/* ================================================= */}

        {selectedMission && (
          <div
            style={
              styles.activeMission
            }
          >
            <div
              style={
                styles.activeTop
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  ACTIVE MISSION
                </div>

                <h2
                  style={
                    styles.activeTitle
                  }
                >
                  {
                    selectedMission.title
                  }
                </h2>
              </div>

              <MissionStatus
                status={
                  selectedMission.status
                }
              />
            </div>

            <p
              style={
                styles.missionGoal
              }
            >
              {
                selectedMission.goal
              }
            </p>

            <div
              style={
                styles.summaryGrid
              }
            >
              <SummaryCard
                label="Budget"
                value={`${selectedMission.budget} U`}
              />

              <SummaryCard
                label="Tasks"
                value={String(
                  selectedMission.tasks
                    .length
                )}
              />

              <SummaryCard
                label="Completed"
                value={`${selectedMission.tasks.filter(
                  (
                    task
                  ) =>
                    task.status ===
                    "Completed"
                ).length}/${
                  selectedMission
                    .tasks.length
                }`}
              />

              <SummaryCard
                label="Category"
                value={
                  selectedMission.category
                }
              />
            </div>

            <div
              style={
                styles.taskSection
              }
            >
              <div
                style={
                  styles.sectionHeader
                }
              >
                <div>
                  <h3
                    style={
                      styles.sectionTitle
                    }
                  >
                    Mission Tasks
                  </h3>

                  <p
                    style={
                      styles.sectionSubtitle
                    }
                  >
                    These become agent jobs in
                    the next marketplace phase.
                  </p>
                </div>
              </div>

              <div
                style={
                  styles.taskList
                }
              >
                {selectedMission.tasks.map(
                  (
                    task
                  ) => (
                    <TaskCard
                      key={
                        task.id
                      }
                      task={
                        task
                      }
                      interactive
                      onStatusChange={(
                        nextStatus
                      ) =>
                        updateTaskStatus(
                          selectedMission.id,
                          task.id,
                          nextStatus
                        )
                      }
                    />
                  )
                )}
              </div>
            </div>

            <div
              style={
                styles.missionFooter
              }
            >
              <div>
                <strong>
                  Project treasury
                </strong>

                <span
                  style={
                    styles.footerMuted
                  }
                >
                  {" "}
                  {selectedMission.budget} U
                </span>
              </div>

              <div
                style={
                  styles.footerNote
                }
              >
                Blockchain sub-jobs will be
                connected in the next phase.
              </div>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* CREATE */}
        {/* ================================================= */}

        <div
          style={
            styles.panel
          }
        >
          <div
            style={
              styles.steps
            }
          >
            <Step
              number="01"
              title="Describe"
              active={
                step ===
                "create"
              }
            />

            <Step
              number="02"
              title="Review team"
              active={
                step ===
                "review"
              }
            />

            <Step
              number="03"
              title="Start mission"
              active={false}
            />
          </div>

          <div
            style={
              styles.divider
            }
          />

          {step ===
          "create" ? (
            <>
              <h2
                style={
                  styles.sectionTitleLarge
                }
              >
                What do you want to accomplish?
              </h2>

              <p
                style={
                  styles.sectionSubtitle
                }
              >
                Describe the result in normal language.
                You don't need to know which agent
                you need.
              </p>

              <textarea
                value={
                  goal
                }
                onChange={(
                  event
                ) =>
                  setGoal(
                    event.target.value
                  )
                }
                placeholder="Example: Build an SEO-ready educational website for mathematics students with lessons, quizzes, a responsive design, and an easy-to-manage content area."
                rows={7}
                style={
                  styles.textarea
                }
              />

              <div
                style={
                  styles.formGrid
                }
              >
                <div>
                  <label
                    style={
                      styles.label
                    }
                  >
                    Total project budget
                  </label>

                  <div
                    style={
                      styles.amountInput
                    }
                  >
                    <input
                      value={
                        budget
                      }
                      onChange={(
                        event
                      ) =>
                        setBudget(
                          event.target
                            .value
                        )
                      }
                      type="number"
                      min="1"
                      step="0.1"
                      style={
                        styles.numberInput
                      }
                    />

                    <span
                      style={
                        styles.currency
                      }
                    >
                      U
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    style={
                      styles.label
                    }
                  >
                    Project category
                  </label>

                  <select
                    value={
                      category
                    }
                    onChange={(
                      event
                    ) =>
                      setCategory(
                        event.target
                          .value
                      )
                    }
                    style={
                      styles.select
                    }
                  >
                    <option>
                      Website Development
                    </option>

                    <option>
                      Software Development
                    </option>

                    <option>
                      Marketing
                    </option>

                    <option>
                      Research
                    </option>

                    <option>
                      Content Creation
                    </option>

                    <option>
                      Data & Analytics
                    </option>

                    <option>
                      Other
                    </option>
                  </select>
                </div>
              </div>

              {plannerMessage && (
                <div
                  style={
                    plannerMessage.includes(
                      "successfully"
                    )
                      ? styles.success
                      : styles.notice
                  }
                >
                  {
                    plannerMessage
                  }
                </div>
              )}

              <button
                onClick={
                  generateTeam
                }
                style={
                  styles.primaryButton
                }
              >
                Generate Agent Team →
              </button>
            </>
          ) : (
            <>
              <div
                style={
                  styles.reviewHeader
                }
              >
                <div>
                  <h2
                    style={
                      styles.sectionTitleLarge
                    }
                  >
                    Review your mission
                  </h2>

                  <p
                    style={
                      styles.sectionSubtitle
                    }
                  >
                    We created a suggested team
                    and divided the budget between
                    their tasks.
                  </p>
                </div>

                <button
                  onClick={() =>
                    setStep(
                      "create"
                    )
                  }
                  style={
                    styles.smallButton
                  }
                >
                  ← Edit
                </button>
              </div>

              <div
                style={
                  styles.missionPreview
                }
              >
                <div
                  style={
                    styles.previewLabel
                  }
                >
                  MISSION
                </div>

                <h3
                  style={
                    styles.previewTitle
                  }
                >
                  {
                    missionTitle
                  }
                </h3>

                <p
                  style={
                    styles.previewGoal
                  }
                >
                  {
                    goal
                  }
                </p>

                <div
                  style={
                    styles.previewMeta
                  }
                >
                  <span>
                    {category}
                  </span>

                  <span>
                    Budget:{" "}
                    <strong>
                      {enteredBudget} U
                    </strong>
                  </span>
                </div>
              </div>

              <div
                style={
                  styles.allocationHeader
                }
              >
                <div>
                  <h3
                    style={
                      styles.sectionTitle
                    }
                  >
                    Recommended team
                  </h3>

                  <p
                    style={
                      styles.sectionSubtitle
                    }
                  >
                    Each specialist gets a
                    separate task and budget.
                  </p>
                </div>

                <button
                  onClick={
                    regenerateTeam
                  }
                  style={
                    styles.smallButton
                  }
                >
                  Regenerate
                </button>
              </div>

              <div
                style={
                  styles.taskList
                }
              >
                {tasks.map(
                  (
                    task
                  ) => (
                    <TaskCard
                      key={
                        task.id
                      }
                      task={
                        task
                      }
                    />
                  )
                )}
              </div>

              <div
                style={
                  allocationMatches
                    ? styles.budgetGood
                    : styles.budgetBad
                }
              >
                <div>
                  <span
                    style={
                      styles.budgetLabel
                    }
                  >
                    Total allocated
                  </span>

                  <strong
                    style={
                      styles.budgetValue
                    }
                  >
                    {
                      totalAllocated
                    }{" "}
                    U
                  </strong>
                </div>

                <div
                  style={
                    styles.budgetRight
                  }
                >
                  <span
                    style={
                      styles.budgetLabel
                    }
                  >
                    Project budget
                  </span>

                  <strong
                    style={
                      styles.budgetValue
                    }
                  >
                    {
                      enteredBudget
                    }{" "}
                    U
                  </strong>
                </div>
              </div>

              {plannerMessage && (
                <div
                  style={
                    styles.notice
                  }
                >
                  {
                    plannerMessage
                  }
                </div>
              )}

              <button
                onClick={
                  startMission
                }
                disabled={
                  !allocationMatches
                }
                style={
                  allocationMatches
                    ? styles.primaryButton
                    : styles.disabledButton
                }
              >
                Start Mission →
              </button>
            </>
          )}
        </div>

        {/* ================================================= */}
        {/* MY MISSIONS */}
        {/* ================================================= */}

        <div
          style={
            styles.panel
          }
        >
          <div
            style={
              styles.sectionHeader
            }
          >
            <div>
              <div
                style={
                  styles.eyebrow
                }
              >
                WORKSPACE
              </div>

              <h2
                style={
                  styles.sectionTitleLarge
                }
              >
                My Missions
              </h2>

              <p
                style={
                  styles.sectionSubtitle
                }
              >
                Projects created on this browser.
              </p>
            </div>

            <div
              style={
                styles.missionCount
              }
            >
              {
                missions.length
              }
            </div>
          </div>

          {missions.length ===
          0 ? (
            <div
              style={
                styles.empty
              }
            >
              <div
                style={
                  styles.emptyIcon
                }
              >
                ✦
              </div>

              <h3>
                No missions yet
              </h3>

              <p>
                Create your first mission above.
              </p>
            </div>
          ) : (
            <div
              style={
                styles.missionList
              }
            >
              {missions.map(
                (
                  mission
                ) => (
                  <button
                    key={
                      mission.id
                    }
                    onClick={() =>
                      openMission(
                        mission
                      )
                    }
                    style={
                      styles.missionRow
                    }
                  >
                    <div
                      style={
                        styles.missionIcon
                      }
                    >
                      {getCategoryIcon(
                        mission.category
                      )}
                    </div>

                    <div
                      style={
                        styles.missionRowMain
                      }
                    >
                      <strong>
                        {
                          mission.title
                        }
                      </strong>

                      <span>
                        {
                          mission.category
                        }{" "}
                        ·{" "}
                        {
                          mission.tasks
                            .length
                        } tasks
                      </span>
                    </div>

                    <div
                      style={
                        styles.missionRowRight
                      }
                    >
                      <strong>
                        {
                          mission.budget
                        }{" "}
                        U
                      </strong>

                      <MissionStatus
                        status={
                          mission.status
                        }
                      />
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/*
 * ============================================================
 * TASK CARD
 * ============================================================
 */

function TaskCard({
  task,
  interactive = false,
  onStatusChange,
}: {
  task: MissionTask;
  interactive?: boolean;
  onStatusChange?: (
    status: MissionTask["status"]
  ) => void;
}) {
  return (
    <div
      style={
        styles.taskCard
      }
    >
      <div
        style={
          styles.taskIcon
        }
      >
        {
          getRoleIcon(
            task.role
          )
        }
      </div>

      <div
        style={
          styles.taskMain
        }
      >
        <div
          style={
            styles.taskTop
          }
        >
          <div>
            <strong
              style={
                styles.taskTitle
              }
            >
              {
                task.title
              }
            </strong>

            <div
              style={
                styles.taskRole
              }
            >
              {
                task.role
              }
            </div>
          </div>

          <div
            style={
              styles.taskBudget
            }
          >
            {
              task.budget
            }{" "}
            U
          </div>
        </div>

        <p
          style={
            styles.taskDescription
          }
        >
          {
            task.description
          }
        </p>

        {interactive &&
          onStatusChange && (
            <select
              value={
                task.status
              }
              onChange={(
                event
              ) =>
                onStatusChange(
                  event.target
                    .value as MissionTask["status"]
                )
              }
              style={
                styles.taskStatusSelect
              }
            >
              <option>
                Planned
              </option>

              <option>
                Ready
              </option>

              <option>
                In Progress
              </option>

              <option>
                Completed
              </option>
            </select>
          )}
      </div>
    </div>
  );
}

/*
 * ============================================================
 * STATUS
 * ============================================================
 */

function MissionStatus({
  status,
}: {
  status: Mission["status"];
}) {
  return (
    <span
      style={
        getStatusStyle(
          status
        )
      }
    >
      {status}
    </span>
  );
}

/*
 * ============================================================
 * SUMMARY
 * ============================================================
 */

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={
        styles.summaryCard
      }
    >
      <span
        style={
          styles.summaryLabel
        }
      >
        {
          label
        }
      </span>

      <strong
        style={
          styles.summaryValue
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
 * STEP
 * ============================================================
 */

function Step({
  number,
  title,
  active,
}: {
  number: string;
  title: string;
  active: boolean;
}) {
  return (
    <div
      style={
        styles.step
      }
    >
      <div
        style={
          active
            ? styles.stepNumberActive
            : styles.stepNumber
        }
      >
        {
          number
        }
      </div>

      <span
        style={
          active
            ? styles.stepTitleActive
            : styles.stepTitle
        }
      >
        {
          title
        }
      </span>
    </div>
  );
}

/*
 * ============================================================
 * TASK PLANNER
 * ============================================================
 */

function generateTasks(
  goal: string,
  totalBudget: number,
  category: string
): MissionTask[] {
  const normalized =
    goal.toLowerCase();

  /*
   * WEBSITE / SOFTWARE
   */
  if (
    category ===
      "Website Development" ||
    category ===
      "Software Development" ||
    normalized.includes(
      "website"
    ) ||
    normalized.includes(
      "web app"
    )
  ) {
    const websiteTasks =
      [
        {
          title:
            "Project Coordination",

          role:
            "Project Manager",

          description:
            "Turn the mission into an execution plan, coordinate specialists, track dependencies, and keep the project aligned with the user's requirements.",

          weight:
            0.15,
        },

        {
          title:
            "UI/UX Design",

          role:
            "UI/UX Designer",

          description:
            "Design the interface, layout, responsive behavior, visual hierarchy, and reusable component structure.",

          weight:
            0.20,
        },

        {
          title:
            "Application Development",

          role:
            "Developer",

          description:
            "Build the website/application, integrate the planned components, implement functionality, and produce a deployable project.",

          weight:
            0.40,
        },

        {
          title:
            "SEO Optimization",

          role:
            "SEO Specialist",

          description:
            "Optimize metadata, semantic structure, indexability, sitemap, robots rules, structured data, and search-friendly content structure.",

          weight:
            0.15,
        },

        {
          title:
            "Quality Assurance",

          role:
            "QA Agent",

          description:
            "Test the final build, inspect responsiveness, links, basic accessibility, functionality, and acceptance criteria before delivery.",

          weight:
            0.10,
        },
      ];

    return allocateTasks(
      websiteTasks,
      totalBudget,
      "website"
    );
  }

  /*
   * MARKETING
   */
  if (
    category ===
      "Marketing" ||
    normalized.includes(
      "marketing"
    ) ||
    normalized.includes(
      "campaign"
    )
  ) {
    return allocateTasks(
      [
        {
          title:
            "Campaign Strategy",

          role:
            "Strategy Agent",

          description:
            "Turn the objective into a measurable campaign plan, audience definition, positioning, and execution roadmap.",

          weight:
            0.25,
        },

        {
          title:
            "Market Research",

          role:
            "Research Agent",

          description:
            "Research the market, competitors, audience behavior, trends, and relevant opportunities.",

          weight:
            0.20,
        },

        {
          title:
            "Creative Content",

          role:
            "Content Agent",

          description:
            "Create campaign copy, concepts, messaging, and supporting content based on the agreed strategy.",

          weight:
            0.30,
        },

        {
          title:
            "Growth & SEO",

          role:
            "Growth Agent",

          description:
            "Optimize discoverability, distribution strategy, and growth opportunities.",

          weight:
            0.15,
        },

        {
          title:
            "Quality Review",

          role:
            "QA Agent",

          description:
            "Review the completed campaign for consistency, accuracy, and alignment with the requested outcome.",

          weight:
            0.10,
        },
      ],
      totalBudget,
      "marketing"
    );
  }

  /*
   * RESEARCH
   */
  if (
    category ===
      "Research" ||
    normalized.includes(
      "research"
    ) ||
    normalized.includes(
      "analyze"
    )
  ) {
    return allocateTasks(
      [
        {
          title:
            "Research Planning",

          role:
            "Research Lead",

          description:
            "Break the research objective into questions, sources, evidence requirements, and a final report structure.",

          weight:
            0.20,
        },

        {
          title:
            "Data Collection",

          role:
            "Research Agent",

          description:
            "Collect relevant information and organize evidence from appropriate sources.",

          weight:
            0.35,
        },

        {
          title:
            "Analysis",

          role:
            "Data Analyst",

          description:
            "Analyze the collected information and identify patterns, comparisons, insights, and useful conclusions.",

          weight:
            0.25,
        },

        {
          title:
            "Report",

          role:
            "Report Agent",

          description:
            "Transform the findings into a clear final deliverable with sources and supporting evidence.",

          weight:
            0.20,
        },
      ],
      totalBudget,
      "research"
    );
  }

  /*
   * DEFAULT
   */
  return allocateTasks(
    [
      {
        title:
          "Mission Planning",

        role:
          "Project Manager",

        description:
          "Clarify the objective, define acceptance criteria, coordinate the team, and manage dependencies.",

        weight:
          0.20,
      },

      {
        title:
          "Primary Execution",

        role:
          "Specialist Agent",

        description:
          "Perform the main work required to achieve the requested outcome.",

        weight:
          0.50,
      },

      {
        title:
          "Quality & Verification",

        role:
          "QA Agent",

        description:
          "Review the result against the user's requirements and prepare the final verified deliverable.",

        weight:
          0.30,
      },
    ],
    totalBudget,
    "general"
  );
}

/*
 * ============================================================
 * ALLOCATOR
 * ============================================================
 */

function allocateTasks(
  rawTasks: Array<{
    title: string;
    role: string;
    description: string;
    weight: number;
  }>,
  totalBudget: number,
  prefix: string
): MissionTask[] {
  const normalizedBudget =
    roundAmount(
      totalBudget
    );

  const rawAmounts =
    rawTasks.map(
      (
        task
      ) =>
        normalizedBudget *
        task.weight
    );

  const rounded =
    rawAmounts.map(
      (
        amount
      ) =>
        roundAmount(
          amount
        )
    );

  let difference =
    roundAmount(
      normalizedBudget -
        rounded.reduce(
          (
            total,
            amount
          ) =>
            total +
            amount,
          0
        )
    );

  /*
   * Put rounding remainder into
   * the largest/primary task.
   */
  if (
    Math.abs(
      difference
    ) >
    0.000001
  ) {
    rounded[0] =
      roundAmount(
        rounded[0] +
          difference
      );
  }

  return rawTasks.map(
    (
      task,
      index
    ) => ({
      id:
        `${prefix}-${index + 1}`,

      title:
        task.title,

      role:
        task.role,

      description:
        task.description,

      budget:
        rounded[index],

      status:
        "Planned",
    })
  );
}

/*
 * ============================================================
 * CATEGORY DETECTION
 * ============================================================
 */

function detectCategory(
  goal: string
): string {
  const value =
    goal.toLowerCase();

  if (
    value.includes(
      "website"
    ) ||
    value.includes(
      "landing page"
    ) ||
    value.includes(
      "web app"
    )
  ) {
    return "Website Development";
  }

  if (
    value.includes(
      "marketing"
    ) ||
    value.includes(
      "campaign"
    ) ||
    value.includes(
      "advert"
    )
  ) {
    return "Marketing";
  }

  if (
    value.includes(
      "research"
    ) ||
    value.includes(
      "competitor"
    ) ||
    value.includes(
      "analyze"
    )
  ) {
    return "Research";
  }

  if (
    value.includes(
      "content"
    ) ||
    value.includes(
      "article"
    ) ||
    value.includes(
      "blog"
    ) ||
    value.includes(
      "copywriting"
    )
  ) {
    return "Content Creation";
  }

  if (
    value.includes(
      "data"
    ) ||
    value.includes(
      "analytics"
    ) ||
    value.includes(
      "dashboard"
    )
  ) {
    return "Data & Analytics";
  }

  return "Software Development";
}

/*
 * ============================================================
 * TITLE
 * ============================================================
 */

function createMissionTitle(
  goal: string,
  category: string
): string {
  const firstSentence =
    goal
      .trim()
      .split(
        /[.!?]/,
        1
      )[0]
      ?.trim();

  if (
    firstSentence &&
    firstSentence.length <=
      70
  ) {
    return capitalize(
      firstSentence
    );
  }

  return `${category} Mission`;
}

/*
 * ============================================================
 * ICONS
 * ============================================================
 */

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
    ) ||
    value.includes(
      "specialist"
    )
  ) {
    return "💻";
  }

  if (
    value.includes(
      "seo"
    ) ||
    value.includes(
      "growth"
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
      "research"
    ) ||
    value.includes(
      "analyst"
    )
  ) {
    return "📊";
  }

  if (
    value.includes(
      "content"
    ) ||
    value.includes(
      "report"
    )
  ) {
    return "📝";
  }

  return "🧠";
}

function getCategoryIcon(
  category: string
): string {
  const value =
    category.toLowerCase();

  if (
    value.includes(
      "website"
    ) ||
    value.includes(
      "software"
    )
  ) {
    return "💻";
  }

  if (
    value.includes(
      "marketing"
    )
  ) {
    return "📣";
  }

  if (
    value.includes(
      "research"
    )
  ) {
    return "🔎";
  }

  if (
    value.includes(
      "content"
    )
  ) {
    return "📝";
  }

  if (
    value.includes(
      "data"
    )
  ) {
    return "📊";
  }

  return "✦";
}

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function createMissionId(): string {
  return `mission-${Date.now()}-${Math.random()
    .toString(
      36
    )
    .slice(
      2,
      8
    )}`;
}

function roundAmount(
  value: number
): number {
  return Number(
    value.toFixed(
      2
    )
  );
}

function capitalize(
  value: string
): string {
  if (
    !value
  ) {
    return value;
  }

  return (
    value.charAt(
      0
    ).toUpperCase() +
    value.slice(
      1
    )
  );
}

function loadMissions(): Mission[] {
  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY
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
      STORAGE_KEY,
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

function getStatusStyle(
  status: Mission["status"]
): React.CSSProperties {
  if (
    status ===
    "Completed"
  ) {
    return styles.statusCompleted;
  }

  if (
    status ===
    "In Progress"
  ) {
    return styles.statusProgress;
  }

  if (
    status ===
    "Planning"
  ) {
    return styles.statusPlanning;
  }

  return styles.statusReady;
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
      "28px 18px 60px",

    background:
      "#090b0d",

    color:
      "#f1f1ef",

    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  container: {
    width:
      "100%",

    maxWidth:
      "980px",

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
      "24px",
  },

  eyebrow: {
    fontSize:
      "11px",

    fontWeight:
      800,

    letterSpacing:
      "0.14em",

    color:
      "#8b929a",
  },

  title: {
    margin:
      "8px 0 8px",

    fontSize:
      "36px",

    lineHeight:
      1.1,

    letterSpacing:
      "-0.03em",
  },

  subtitle: {
    maxWidth:
      "680px",

    margin:
      0,

    color:
      "#979da4",

    lineHeight:
      1.65,

    fontSize:
      "15px",
  },

  heroBadge: {
    padding:
      "10px 12px",

    borderRadius:
      "12px",

    border:
      "1px solid #2a2f33",

    background:
      "#111518",

    color:
      "#d5d9dc",

    fontSize:
      "10px",

    fontWeight:
      900,

    letterSpacing:
      "0.1em",

    textAlign:
      "center",

    lineHeight:
      1.5,
  },

  panel: {
    padding:
      "20px",

    marginBottom:
      "18px",

    border:
      "1px solid #252a2e",

    borderRadius:
      "16px",

    background:
      "#111417",

    boxShadow:
      "0 8px 30px rgba(0,0,0,.18)",
  },

  activeMission: {
    padding:
      "20px",

    marginBottom:
      "18px",

    border:
      "1px solid #3a3320",

    borderRadius:
      "16px",

    background:
      "#121312",
  },

  activeTop: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "flex-start",

    gap:
      "16px",
  },

  activeTitle: {
    margin:
      "8px 0 0",

    fontSize:
      "25px",

    letterSpacing:
      "-0.02em",
  },

  missionGoal: {
    color:
      "#b1b6bb",

    lineHeight:
      1.65,

    margin:
      "16px 0 0",
  },

  summaryGrid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(auto-fit, minmax(140px, 1fr))",

    gap:
      "10px",

    marginTop:
      "18px",
  },

  summaryCard: {
    padding:
      "14px",

    borderRadius:
      "12px",

    background:
      "#0d1012",

    border:
      "1px solid #22272b",
  },

  summaryLabel: {
    display:
      "block",

    fontSize:
      "11px",

    color:
      "#757c83",

    marginBottom:
      "6px",

    textTransform:
      "uppercase",

    letterSpacing:
      "0.06em",
  },

  summaryValue: {
    fontSize:
      "16px",

    color:
      "#f0f1ef",
  },

  taskSection: {
    marginTop:
      "22px",
  },

  sectionHeader: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "flex-start",

    gap:
      "16px",
  },

  sectionTitleLarge: {
    margin:
      0,

    fontSize:
      "22px",

    letterSpacing:
      "-0.02em",
  },

  sectionTitle: {
    margin:
      0,

    fontSize:
      "18px",

    letterSpacing:
      "-0.02em",
  },

  sectionSubtitle: {
    margin:
      "5px 0 0",

    color:
      "#7f878e",

    fontSize:
      "13px",

    lineHeight:
      1.55,
  },

  steps: {
    display:
      "flex",

    flexWrap:
      "wrap",

    gap:
      "20px",
  },

  step: {
    display:
      "flex",

    alignItems:
      "center",

    gap:
      "8px",
  },

  stepNumber: {
    width:
      "28px",

    height:
      "28px",

    display:
      "grid",

    placeItems:
      "center",

    borderRadius:
      "50%",

    background:
      "#1a1e21",

    border:
      "1px solid #31373c",

    color:
      "#777f86",

    fontSize:
      "11px",

    fontWeight:
      800,
  },

  stepNumberActive: {
    width:
      "28px",

    height:
      "28px",

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
      "11px",

    fontWeight:
      900,
  },

  stepTitle: {
    color:
      "#656d74",

    fontSize:
      "13px",

    fontWeight:
      700,
  },

  stepTitleActive: {
    color:
      "#f1f1ef",

    fontSize:
      "13px",

    fontWeight:
      800,
  },

  divider: {
    height:
      "1px",

    margin:
      "18px 0 22px",

    background:
      "#24292d",
  },

  textarea: {
    width:
      "100%",

    boxSizing:
      "border-box",

    marginTop:
      "16px",

    padding:
      "14px",

    borderRadius:
      "12px",

    border:
      "1px solid #343a3f",

    outline:
      "none",

    background:
      "#0b0e10",

    color:
      "#f5f5f3",

    resize:
      "vertical",

    fontFamily:
      "inherit",

    fontSize:
      "14px",

    lineHeight:
      1.6,
  },

  formGrid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",

    gap:
      "14px",

    marginTop:
      "16px",
  },

  label: {
    display:
      "block",

    marginBottom:
      "8px",

    color:
      "#80878e",

    fontSize:
      "11px",

    fontWeight:
      800,

    letterSpacing:
      "0.08em",

    textTransform:
      "uppercase",
  },

  amountInput: {
    display:
      "flex",

    alignItems:
      "center",

    gap:
      "8px",

    padding:
      "0 12px",

    borderRadius:
      "10px",

    border:
      "1px solid #343a3f",

    background:
      "#0b0e10",
  },

  numberInput: {
    width:
      "100%",

    padding:
      "12px 0",

    border:
      "none",

    outline:
      "none",

    background:
      "transparent",

    color:
      "#fff",

    fontSize:
      "15px",
  },

  currency: {
    color:
      "#f0b90b",

    fontWeight:
      900,
  },

  select: {
    width:
      "100%",

    boxSizing:
      "border-box",

    padding:
      "12px",

    borderRadius:
      "10px",

    border:
      "1px solid #343a3f",

    background:
      "#0b0e10",

    color:
      "#fff",

    outline:
      "none",
  },

  primaryButton: {
    width:
      "100%",

    marginTop:
      "18px",

    padding:
      "14px 18px",

    border:
      "none",

    borderRadius:
      "11px",

    background:
      "#f0b90b",

    color:
      "#101010",

    fontWeight:
      900,

    cursor:
      "pointer",

    fontSize:
      "14px",
  },

  disabledButton: {
    width:
      "100%",

    marginTop:
      "18px",

    padding:
      "14px 18px",

    border:
      "none",

    borderRadius:
      "11px",

    background:
      "#2a2e31",

    color:
      "#666d73",

    fontWeight:
      900,

    cursor:
      "not-allowed",

    fontSize:
      "14px",
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
      "#d8dcdf",

    fontWeight:
      700,

    cursor:
      "pointer",

    fontSize:
      "12px",
  },

  notice: {
    marginTop:
      "14px",

    padding:
      "12px",

    borderRadius:
      "10px",

    background:
      "#161719",

    border:
      "1px solid #36393d",

    color:
      "#b7bdc2",

    fontSize:
      "13px",
  },

  success: {
    marginTop:
      "14px",

    padding:
      "12px",

    borderRadius:
      "10px",

    background:
      "#101916",

    border:
      "1px solid #244236",

    color:
      "#81d6a9",

    fontSize:
      "13px",
  },

  reviewHeader: {
    display:
      "flex",

    justifyContent:
      "space-between",

    gap:
      "14px",

    alignItems:
      "flex-start",
  },

  missionPreview: {
    marginTop:
      "20px",

    padding:
      "16px",

    borderRadius:
      "12px",

    background:
      "#0d1012",

    border:
      "1px solid #252a2e",
  },

  previewLabel: {
    fontSize:
      "10px",

    fontWeight:
      900,

    letterSpacing:
      "0.12em",

    color:
      "#777f86",
  },

  previewTitle: {
    margin:
      "8px 0 6px",

    fontSize:
      "19px",
  },

  previewGoal: {
    margin:
      0,

    color:
      "#a7adb2",

    lineHeight:
      1.55,

    fontSize:
      "13px",
  },

  previewMeta: {
    display:
      "flex",

    justifyContent:
      "space-between",

    flexWrap:
      "wrap",

    gap:
      "10px",

    marginTop:
      "14px",

    color:
      "#7f878e",

    fontSize:
      "12px",
  },

  allocationHeader: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "center",

    gap:
      "14px",

    marginTop:
      "22px",
  },

  taskList: {
    display:
      "grid",

    gap:
      "10px",

    marginTop:
      "14px",
  },

  taskCard: {
    display:
      "flex",

    gap:
      "12px",

    padding:
      "14px",

    borderRadius:
      "12px",

    border:
      "1px solid #272c30",

    background:
      "#0d1012",
  },

  taskIcon: {
    width:
      "40px",

    height:
      "40px",

    flexShrink:
      0,

    display:
      "grid",

    placeItems:
      "center",

    borderRadius:
      "10px",

    background:
      "#171b1e",

    fontSize:
      "19px",
  },

  taskMain: {
    minWidth:
      0,

    width:
      "100%",
  },

  taskTop: {
    display:
      "flex",

    justifyContent:
      "space-between",

    gap:
      "12px",

    alignItems:
      "flex-start",
  },

  taskTitle: {
    display:
      "block",

    fontSize:
      "14px",
  },

  taskRole: {
    marginTop:
      "3px",

    fontSize:
      "11px",

    color:
      "#7c848b",
  },

  taskBudget: {
    flexShrink:
      0,

    padding:
      "6px 9px",

    borderRadius:
      "8px",

    background:
      "#1a1810",

    color:
      "#f0b90b",

    fontWeight:
      900,

    fontSize:
      "12px",
  },

  taskDescription: {
    margin:
      "10px 0 0",

    color:
      "#929aa1",

    lineHeight:
      1.55,

    fontSize:
      "12px",
  },

  taskStatusSelect: {
    marginTop:
      "10px",

    padding:
      "8px",

    borderRadius:
      "8px",

    border:
      "1px solid #343a3f",

    background:
      "#111518",

    color:
      "#fff",

    fontSize:
      "12px",
  },

  budgetGood: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "center",

    gap:
      "12px",

    marginTop:
      "16px",

    padding:
      "14px",

    borderRadius:
      "11px",

    background:
      "#101916",

    border:
      "1px solid #244236",
  },

  budgetBad: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "center",

    gap:
      "12px",

    marginTop:
      "16px",

    padding:
      "14px",

    borderRadius:
      "11px",

    background:
      "#191511",

    border:
      "1px solid #4c3820",
  },

  budgetLabel: {
    display:
      "block",

    fontSize:
      "10px",

    color:
      "#788087",

    textTransform:
      "uppercase",

    letterSpacing:
      "0.08em",
  },

  budgetValue: {
    display:
      "block",

    marginTop:
      "4px",

    fontSize:
      "16px",
  },

  budgetRight: {
    textAlign:
      "right",
  },

  missionFooter: {
    display:
      "flex",

    justifyContent:
      "space-between",

    flexWrap:
      "wrap",

    gap:
      "10px",

    marginTop:
      "18px",

    paddingTop:
      "16px",

    borderTop:
      "1px solid #252a2e",

    color:
      "#d3d7da",

    fontSize:
      "13px",
  },

  footerMuted: {
    color:
      "#f0b90b",

    fontWeight:
      800,
  },

  footerNote: {
    color:
      "#70787f",

    fontSize:
      "12px",
  },

  missionCount: {
    minWidth:
      "32px",

    height:
      "32px",

    display:
      "grid",

    placeItems:
      "center",

    padding:
      "0 8px",

    borderRadius:
      "9px",

    background:
      "#1a1e21",

    color:
      "#d6dadd",

    fontWeight:
      800,
  },

  missionList: {
    display:
      "grid",

    gap:
      "8px",

    marginTop:
      "16px",
  },

  missionRow: {
    width:
      "100%",

    display:
      "flex",

    alignItems:
      "center",

    gap:
      "12px",

    padding:
      "13px",

    textAlign:
      "left",

    borderRadius:
      "11px",

    border:
      "1px solid #262b2f",

    background:
      "#0d1012",

    color:
      "#fff",

    cursor:
      "pointer",
  },

  missionIcon: {
    width:
      "38px",

    height:
      "38px",

    flexShrink:
      0,

    display:
      "grid",

    placeItems:
      "center",

    borderRadius:
      "10px",

    background:
      "#171b1e",

    fontSize:
      "18px",
  },

  missionRowMain: {
    flex:
      1,

    minWidth:
      0,

    display:
      "grid",

    gap:
      "3px",
  },

  missionRowRight: {
    display:
      "grid",

    justifyItems:
      "end",

    gap:
      "6px",
  },

  empty: {
    padding:
      "40px 20px",

    textAlign:
      "center",

    color:
      "#767e85",
  },

  emptyIcon: {
    fontSize:
      "30px",

    marginBottom:
      "10px",
  },

  statusPlanning: {
    display:
      "inline-flex",

    alignItems:
      "center",

    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#1b1c14",

    color:
      "#d9c766",

    fontSize:
      "10px",

    fontWeight:
      800,
  },

  statusReady: {
    display:
      "inline-flex",

    alignItems:
      "center",

    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#141b21",

    color:
      "#92b9d8",

    fontSize:
      "10px",

    fontWeight:
      800,
  },

  statusProgress: {
    display:
      "inline-flex",

    alignItems:
      "center",

    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#171d17",

    color:
      "#83c895",

    fontSize:
      "10px",

    fontWeight:
      800,
  },

  statusCompleted: {
    display:
      "inline-flex",

    alignItems:
      "center",

    padding:
      "5px 8px",

    borderRadius:
      "999px",

    background:
      "#101916",

    color:
      "#7bd4a5",

    fontSize:
      "10px",

    fontWeight:
      800,
  },
};
