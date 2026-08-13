import {
  useEffect,
  useMemo,
  useState,
} from "react";

type MissionStatus =
  | "Planning"
  | "Ready"
  | "In Progress"
  | "Completed";

type TaskStatus =
  | "Planned"
  | "Ready"
  | "In Progress"
  | "Completed";

type MissionTask = {
  id: string;
  title: string;
  role: string;
  description: string;
  budget: number;
  status: TaskStatus;
  assignedAgentId?: string;
};

type Mission = {
  id: string;
  title: string;
  goal: string;
  category: string;
  budget: number;
  createdAt: string;
  status: MissionStatus;
  tasks: MissionTask[];
};

type Agent = {
  id: string;
  name: string;
  role: string;
};

type ChatMessage = {
  id: string;
  sender: string;
  role: string;
  message: string;
  timestamp: string;
  kind: "user" | "agent";
};

type ActivityItem = {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  icon: string;
};

type ProjectFile = {
  id: string;
  name: string;
  type: string;
  size: string;
  updatedAt: string;
};

const MISSION_STORAGE_KEY =
  "bnb_agent_marketplace_missions";

const SELECTED_MISSION_KEY =
  "bnb_agent_marketplace_selected_mission";

const CHAT_PREFIX =
  "bnb_agent_marketplace_chat_";

const ACTIVITY_PREFIX =
  "bnb_agent_marketplace_activity_";

const FILES_PREFIX =
  "bnb_agent_marketplace_files_";

const AGENTS: Agent[] = [
  {
    id: "taskpilot",
    name: "TaskPilot",
    role: "Project Manager",
  },
  {
    id: "pixelcraft",
    name: "PixelCraft",
    role: "UI/UX Designer",
  },
  {
    id: "codeforge",
    name: "CodeForge",
    role: "Developer",
  },
  {
    id: "rankpilot",
    name: "RankPilot",
    role: "SEO Specialist",
  },
  {
    id: "verifyai",
    name: "VerifyAI",
    role: "QA Agent",
  },
];

type Tab =
  | "overview"
  | "tasks"
  | "team"
  | "chat"
  | "files"
  | "deliverables"
  | "activity";

export default function MissionWorkspace() {
  const [missions, setMissions] =
    useState<Mission[]>(
      loadMissions()
    );

  const [selectedMissionId, setSelectedMissionId] =
    useState<string | null>(
      loadSelectedMissionId()
    );

  const [activeTab, setActiveTab] =
    useState<Tab>("overview");

  const [messages, setMessages] =
    useState<ChatMessage[]>([]);

  const [activity, setActivity] =
    useState<ActivityItem[]>([]);

  const [files, setFiles] =
    useState<ProjectFile[]>([]);

  const [messageInput, setMessageInput] =
    useState("");

  const [notice, setNotice] =
    useState("");

  const mission =
    missions.find(
      (item) =>
        item.id ===
        selectedMissionId
    ) ?? null;

  /*
   * ============================================================
   * LOAD PROJECT DATA
   * ============================================================
   */

  useEffect(() => {
    if (!mission) {
      setMessages([]);
      setActivity([]);
      setFiles([]);
      return;
    }

    setMessages(
      loadMessages(
        mission.id
      )
    );

    setActivity(
      loadActivity(
        mission.id
      )
    );

    setFiles(
      loadFiles(
        mission.id
      )
    );
  }, [mission?.id]);

  /*
   * ============================================================
   * AUTO SELECT
   * ============================================================
   */

  useEffect(() => {
    if (
      !selectedMissionId &&
      missions.length > 0
    ) {
      setSelectedMissionId(
        missions[0].id
      );

      saveSelectedMissionId(
        missions[0].id
      );
    }
  }, [
    missions,
    selectedMissionId,
  ]);

  /*
   * ============================================================
   * REFRESH
   * ============================================================
   */

  function refreshWorkspace() {
    setMissions(
      loadMissions()
    );

    setNotice(
      "Workspace refreshed."
    );
  }

  /*
   * ============================================================
   * SELECT MISSION
   * ============================================================
   */

  function selectMission(
    id: string
  ) {
    setSelectedMissionId(
      id
    );

    saveSelectedMissionId(
      id
    );

    setNotice("");
  }

  /*
   * ============================================================
   * START MISSION
   * ============================================================
   */

  function startMission() {
    if (!mission) {
      return;
    }

    const unassigned =
      mission.tasks.find(
        (task) =>
          !task.assignedAgentId
      );

    if (unassigned) {
      setNotice(
        `Assign an agent to "${unassigned.title}" before starting the mission.`
      );

      setActiveTab(
        "tasks"
      );

      return;
    }

    const updated: Mission[] =
      missions.map(
        (item): Mission => {
          if (
            item.id !==
            mission.id
          ) {
            return item;
          }

          return {
            ...item,
            status:
              "In Progress",
            tasks:
              item.tasks.map(
                (
                  task,
                  index
                ): MissionTask => ({
                  ...task,
                  status:
                    index === 0
                      ? "In Progress"
                      : "Ready",
                })
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

    addActivity({
      title:
        "Mission started",
      description:
        "The assigned agent team is now ready to work.",
      icon:
        "🚀",
    });

    addMessage({
      sender:
        "TaskPilot",
      role:
        "Project Manager",
      message:
        "Mission started. I confirmed the assigned team and will coordinate the work.",
      kind:
        "agent",
    });

    setNotice(
      "Mission started successfully."
    );
  }

  /*
   * ============================================================
   * UPDATE TASK
   * ============================================================
   */

  function updateTask(
    taskId: string,
    status: TaskStatus
  ) {
    if (!mission) {
      return;
    }

    const target =
      mission.tasks.find(
        (task) =>
          task.id ===
          taskId
      );

    const updated: Mission[] =
      missions.map(
        (item): Mission => {
          if (
            item.id !==
            mission.id
          ) {
            return item;
          }

          const tasks =
            item.tasks.map(
              (
                task
              ): MissionTask =>
                task.id ===
                taskId
                  ? {
                      ...task,
                      status,
                    }
                  : task
            );

          const allCompleted =
            tasks.length >
              0 &&
            tasks.every(
              (task) =>
                task.status ===
                "Completed"
            );

          const started =
            tasks.some(
              (task) =>
                task.status ===
                  "Ready" ||
                task.status ===
                  "In Progress" ||
                task.status ===
                  "Completed"
            );

          const missionStatus: MissionStatus =
            allCompleted
              ? "Completed"
              : started
              ? "In Progress"
              : "Planning";

          return {
            ...item,
            tasks,
            status:
              missionStatus,
          };
        }
      );

    setMissions(
      updated
    );

    saveMissions(
      updated
    );

    addActivity({
      title:
        `${target?.title ?? "Task"} updated`,
      description:
        `Task status changed to ${status}.`,
      icon:
        status ===
        "Completed"
          ? "✅"
          : status ===
            "In Progress"
          ? "🔄"
          : "📋",
    });

    setNotice(
      "Task updated."
    );
  }

  /*
   * ============================================================
   * SEND MESSAGE
   * ============================================================
   */

  function sendMessage() {
    if (
      !mission ||
      !messageInput.trim()
    ) {
      return;
    }

    addMessage({
      sender:
        "You",
      role:
        "Client",
      message:
        messageInput.trim(),
      kind:
        "user",
    });

    setMessageInput("");

    setNotice(
      "Message sent to the project room."
    );
  }

  /*
   * ============================================================
   * ADD MESSAGE
   * ============================================================
   */

  function addMessage(
    input: Omit<
      ChatMessage,
      "id" | "timestamp"
    >
  ) {
    if (!mission) {
      return;
    }

    const item: ChatMessage =
      {
        ...input,
        id:
          createId(),
        timestamp:
          new Date().toISOString(),
      };

    const updated = [
      ...messages,
      item,
    ];

    setMessages(
      updated
    );

    saveMessages(
      mission.id,
      updated
    );
  }

  /*
   * ============================================================
   * ADD ACTIVITY
   * ============================================================
   */

  function addActivity(
    input: Omit<
      ActivityItem,
      "id" | "timestamp"
    >
  ) {
    if (!mission) {
      return;
    }

    const item: ActivityItem =
      {
        ...input,
        id:
          createId(),
        timestamp:
          new Date().toISOString(),
      };

    const updated = [
      item,
      ...activity,
    ];

    setActivity(
      updated
    );

    saveActivity(
      mission.id,
      updated
    );
  }

  /*
   * ============================================================
   * DEMO FILE
   * ============================================================
   */

  function addDemoFile() {
    if (!mission) {
      return;
    }

    const file: ProjectFile =
      {
        id:
          createId(),
        name:
          "project-plan.md",
        type:
          "Markdown",
        size:
          "4.2 KB",
        updatedAt:
          new Date().toISOString(),
      };

    const updated = [
      file,
      ...files.filter(
        (item) =>
          item.name !==
          file.name
      ),
    ];

    setFiles(
      updated
    );

    saveFiles(
      mission.id,
      updated
    );

    addActivity({
      title:
        "Project artifact created",
      description:
        "TaskPilot created project-plan.md.",
      icon:
        "📄",
    });

    setNotice(
      "Demo artifact created."
    );
  }

  /*
   * ============================================================
   * PROGRESS
   * ============================================================
   */

  const progress =
    useMemo(() => {
      if (
        !mission ||
        mission.tasks.length ===
          0
      ) {
        return 0;
      }

      const completed =
        mission.tasks.filter(
          (task) =>
            task.status ===
            "Completed"
        ).length;

      const working =
        mission.tasks.filter(
          (task) =>
            task.status ===
            "In Progress"
        ).length;

      return Math.round(
        ((completed +
          working * 0.5) /
          mission.tasks.length) *
          100
      );
    }, [mission]);

  /*
   * ============================================================
   * EMPTY STATE
   * ============================================================
   */

  if (
    missions.length ===
    0
  ) {
    return (
      <div
        style={
          styles.page
        }
      >
        <div
          style={
            styles.emptyPage
          }
        >
          <div
            style={
              styles.emptyIcon
            }
          >
            🧭
          </div>

          <h1>
            No mission yet
          </h1>

          <p>
            Create a mission from Marketplace first.
          </p>

          <button
            onClick={
              refreshWorkspace
            }
            style={
              styles.secondaryButton
            }
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  if (!mission) {
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
          <h1>
            Select a mission
          </h1>

          <div
            style={
              styles.missionPicker
            }
          >
            {missions.map(
              (item) => (
                <button
                  key={
                    item.id
                  }
                  onClick={() =>
                    selectMission(
                      item.id
                    )
                  }
                  style={
                    styles.missionPickerButton
                  }
                >
                  <strong>
                    {
                      item.title
                    }
                  </strong>

                  <span>
                    {
                      item.budget
                    }{" "}
                    U
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * MAIN UI
   * ============================================================
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
        {/* HEADER */}

        <div
          style={
            styles.header
          }
        >
          <div>
            <div
              style={
                styles.eyebrow
              }
            >
              MISSION WORKSPACE
            </div>

            <h1
              style={
                styles.title
              }
            >
              {
                mission.title
              }
            </h1>

            <p
              style={
                styles.subtitle
              }
            >
              {
                mission.goal
              }
            </p>
          </div>

          <div
            style={
              styles.headerActions
            }
          >
            <select
              value={
                mission.id
              }
              onChange={(
                event
              ) =>
                selectMission(
                  event.target.value
                )
              }
              style={
                styles.missionSelect
              }
            >
              {missions.map(
                (item) => (
                  <option
                    key={
                      item.id
                    }
                    value={
                      item.id
                    }
                  >
                    {
                      item.title
                    }
                  </option>
                )
              )}
            </select>

            <button
              onClick={
                refreshWorkspace
              }
              style={
                styles.smallButton
              }
            >
              Refresh
            </button>
          </div>
        </div>

        {/* PROGRESS */}

        <div
          style={
            styles.progressCard
          }
        >
          <div
            style={
              styles.progressTop
            }
          >
            <div>
              <div
                style={
                  styles.progressLabel
                }
              >
                PROJECT PROGRESS
              </div>

              <strong
                style={
                  styles.progressValue
                }
              >
                {
                  progress
                }
                %
              </strong>
            </div>

            <StatusBadge
              status={
                mission.status
              }
            />
          </div>

          <div
            style={
              styles.progressTrack
            }
          >
            <div
              style={{
                ...styles.progressFill,
                width:
                  `${progress}%`,
              }}
            />
          </div>

          <div
            style={
              styles.progressMeta
            }
          >
            <span>
              {
                mission.tasks.filter(
                  (task) =>
                    task.status ===
                    "Completed"
                ).length
              }{" "}
              completed
            </span>

            <span>
              {
                mission.tasks.length
              }{" "}
              tasks
            </span>

            <span>
              {
                mission.budget
              }{" "}
              U
            </span>
          </div>
        </div>

        {/* TABS */}

        <div
          style={
            styles.tabs
          }
        >
          {(
            [
              [
                "overview",
                "Overview",
              ],
              [
                "tasks",
                "Tasks",
              ],
              [
                "team",
                "Team",
              ],
              [
                "chat",
                "Communication",
              ],
              [
                "files",
                "Files",
              ],
              [
                "deliverables",
                "Deliverables",
              ],
              [
                "activity",
                "Activity",
              ],
            ] as Array<
              [Tab, string]
            >
          ).map(
            ([key, label]) => (
              <button
                key={
                  key
                }
                onClick={() =>
                  setActiveTab(
                    key
                  )
                }
                style={
                  activeTab ===
                  key
                    ? styles.tabActive
                    : styles.tab
                }
              >
                {
                  label
                }
              </button>
            )
          )}
        </div>

        {notice && (
          <div
            style={
              styles.notice
            }
          >
            {
              notice
            }
          </div>
        )}

        {/* OVERVIEW */}

        {activeTab ===
          "overview" && (
          <div
            style={
              styles.grid
            }
          >
            <div
              style={
                styles.panel
              }
            >
              <div
                style={
                  styles.panelHeader
                }
              >
                <div>
                  <div
                    style={
                      styles.eyebrow
                    }
                  >
                    PROJECT
                  </div>

                  <h2
                    style={
                      styles.panelTitle
                    }
                  >
                    {
                      mission.title
                    }
                  </h2>
                </div>

                <StatusBadge
                  status={
                    mission.status
                  }
                />
              </div>

              <p
                style={
                  styles.goal
                }
              >
                {
                  mission.goal
                }
              </p>

              <div
                style={
                  styles.infoGrid
                }
              >
                <InfoCard
                  label="Budget"
                  value={`${mission.budget} U`}
                />

                <InfoCard
                  label="Tasks"
                  value={String(
                    mission.tasks.length
                  )}
                />

                <InfoCard
                  label="Assigned"
                  value={`${mission.tasks.filter(
                    (task) =>
                      Boolean(
                        task.assignedAgentId
                      )
                  ).length}/${
                    mission.tasks.length
                  }`}
                />

                <InfoCard
                  label="Created"
                  value={
                    formatDate(
                      mission.createdAt
                    )
                  }
                />
              </div>

              {mission.status ===
                "Planning" && (
                <button
                  onClick={
                    startMission
                  }
                  style={
                    styles.primaryButton
                  }
                >
                  🚀 Start Mission
                </button>
              )}
            </div>

            <div
              style={
                styles.panel
              }
            >
              <div
                style={
                  styles.panelHeader
                }
              >
                <div>
                  <div
                    style={
                      styles.eyebrow
                    }
                  >
                    ASSIGNED TEAM
                  </div>

                  <h2
                    style={
                      styles.panelTitle
                    }
                  >
                    Agent Team
                  </h2>
                </div>
              </div>

              <div
                style={
                  styles.teamList
                }
              >
                {mission.tasks.map(
                  (task) => {
                    const agent =
                      findAgent(
                        task.assignedAgentId
                      );

                    return (
                      <TeamMember
                        key={
                          task.id
                        }
                        task={
                          task
                        }
                        agent={
                          agent
                        }
                      />
                    );
                  }
                )}
              </div>
            </div>
          </div>
        )}

        {/* TASKS */}

        {activeTab ===
          "tasks" && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.panelHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  EXECUTION
                </div>

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Mission Tasks
                </h2>

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  Assigned tasks become ERC-8183
                  sub-jobs in the next phase.
                </p>
              </div>

              <div
                style={
                  styles.budgetPill
                }
              >
                {
                  mission.budget
                }{" "}
                U
              </div>
            </div>

            <div
              style={
                styles.taskList
              }
            >
              {mission.tasks.map(
                (task) => {
                  const agent =
                    findAgent(
                      task.assignedAgentId
                    );

                  return (
                    <div
                      key={
                        task.id
                      }
                      style={
                        styles.taskCard
                      }
                    >
                      <div
                        style={
                          styles.taskAvatar
                        }
                      >
                        {
                          getRoleIcon(
                            agent?.role ??
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
                            <strong>
                              {
                                task.title
                              }
                            </strong>

                            <span
                              style={
                                styles.taskRole
                              }
                            >
                              {agent
                                ? `${agent.name} · ${agent.role}`
                                : `${task.role} · No agent assigned`}
                            </span>
                          </div>

                          <strong
                            style={
                              styles.taskBudget
                            }
                          >
                            {
                              task.budget
                            }{" "}
                            U
                          </strong>
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

                        <div
                          style={
                            styles.taskControls
                          }
                        >
                          <TaskStatusBadge
                            status={
                              task.status
                            }
                          />

                          <select
                            value={
                              task.status
                            }
                            onChange={(
                              event
                            ) =>
                              updateTask(
                                task.id,
                                event.target
                                  .value as TaskStatus
                              )
                            }
                            style={
                              styles.statusSelect
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
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* TEAM */}

        {activeTab ===
          "team" && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.panelHeader
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

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Your Team
                </h2>
              </div>
            </div>

            <div
              style={
                styles.teamGrid
              }
            >
              {mission.tasks.map(
                (task) => {
                  const agent =
                    findAgent(
                      task.assignedAgentId
                    );

                  return (
                    <div
                      key={
                        task.id
                      }
                      style={
                        styles.agentCard
                      }
                    >
                      <div
                        style={
                          styles.agentAvatar
                        }
                      >
                        {
                          getRoleIcon(
                            agent?.role ??
                              task.role
                          )
                        }
                      </div>

                      <div
                        style={
                          styles.agentInfo
                        }
                      >
                        <strong>
                          {agent
                            ? agent.name
                            : "Unassigned"}
                        </strong>

                        <span
                          style={
                            styles.agentTask
                          }
                        >
                          {
                            task.title
                          }
                        </span>

                        <span
                          style={
                            styles.agentBudget
                          }
                        >
                          {
                            task.budget
                          }{" "}
                          U
                        </span>
                      </div>

                      <TaskStatusBadge
                        status={
                          task.status
                        }
                      />
                    </div>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* CHAT */}

        {activeTab ===
          "chat" && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.panelHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  PROJECT ROOM
                </div>

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Communication
                </h2>

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  Client and agent communication for this
                  mission.
                </p>
              </div>
            </div>

            <div
              style={
                styles.chatBox
              }
            >
              {messages.length ===
              0 ? (
                <div
                  style={
                    styles.emptyChat
                  }
                >
                  💬
                  <strong>
                    No messages yet
                  </strong>

                  <span>
                    Start the conversation below.
                  </span>
                </div>
              ) : (
                messages.map(
                  (message) => (
                    <ChatBubble
                      key={
                        message.id
                      }
                      message={
                        message
                      }
                    />
                  )
                )
              )}
            </div>

            <textarea
              value={
                messageInput
              }
              onChange={(
                event
              ) =>
                setMessageInput(
                  event.target.value
                )
              }
              placeholder="Message the project team..."
              rows={3}
              style={
                styles.messageInput
              }
            />

            <button
              onClick={
                sendMessage
              }
              disabled={
                !messageInput.trim()
              }
              style={
                messageInput.trim()
                  ? styles.primaryButton
                  : styles.disabledButton
              }
            >
              Send Message
            </button>
          </div>
        )}

        {/* FILES */}

        {activeTab ===
          "files" && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.panelHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  SHARED FILES
                </div>

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Project Files
                </h2>
              </div>

              <button
                onClick={
                  addDemoFile
                }
                style={
                  styles.smallButton
                }
              >
                + Demo Artifact
              </button>
            </div>

            {files.length ===
            0 ? (
              <div
                style={
                  styles.empty
                }
              >
                📁
                <p>
                  No project files yet.
                </p>
              </div>
            ) : (
              <div
                style={
                  styles.fileList
                }
              >
                {files.map(
                  (file) => (
                    <div
                      key={
                        file.id
                      }
                      style={
                        styles.fileRow
                      }
                    >
                      <div
                        style={
                          styles.fileIcon
                        }
                      >
                        📄
                      </div>

                      <div
                        style={
                          styles.fileInfo
                        }
                      >
                        <strong>
                          {
                            file.name
                          }
                        </strong>

                        <span>
                          {
                            file.type
                          }{" "}
                          ·{" "}
                          {
                            file.size
                          }
                        </span>
                      </div>

                      <span
                        style={
                          styles.fileDate
                        }
                      >
                        {
                          formatDate(
                            file.updatedAt
                          )
                        }
                      </span>
                    </div>
                  )
                )}
              </div>
            )}

            <div
              style={
                styles.comingSoon
              }
            >
              <strong>
                Next:
              </strong>{" "}
              Git repository integration so software
              agents can work on a shared codebase.
            </div>
          </div>
        )}

        {/* DELIVERABLES */}

        {activeTab ===
          "deliverables" && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.panelHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  DELIVERY
                </div>

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Final Deliverables
                </h2>

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  The finished project will be delivered
                  here.
                </p>
              </div>
            </div>

            <div
              style={
                styles.deliveryGrid
              }
            >
              <DeliveryCard
                icon="🌐"
                title="Live Preview"
                description="Open the finished project."
              />

              <DeliveryCard
                icon="💻"
                title="Source Code"
                description="Browse the final code."
              />

              <DeliveryCard
                icon="📦"
                title="Download"
                description="Download the final ZIP."
              />

              <DeliveryCard
                icon="🚀"
                title="Deployment"
                description="Deploy the completed project."
              />
            </div>

            <div
              style={
                styles.comingSoon
              }
            >
              Final delivery will connect the agent
              artifacts, evaluator result, Git repository,
              preview, and downloadable project package.
            </div>
          </div>
        )}

        {/* ACTIVITY */}

        {activeTab ===
          "activity" && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.panelHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  AUDIT TRAIL
                </div>

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Activity
                </h2>
              </div>
            </div>

            {activity.length ===
            0 ? (
              <div
                style={
                  styles.empty
                }
              >
                🕘
                <p>
                  No activity yet.
                </p>
              </div>
            ) : (
              <div
                style={
                  styles.activityList
                }
              >
                {activity.map(
                  (item) => (
                    <div
                      key={
                        item.id
                      }
                      style={
                        styles.activityRow
                      }
                    >
                      <div
                        style={
                          styles.activityIcon
                        }
                      >
                        {
                          item.icon
                        }
                      </div>

                      <div
                        style={
                          styles.activityMain
                        }
                      >
                        <strong>
                          {
                            item.title
                          }
                        </strong>

                        <p
                          style={
                            styles.activityDescription
                          }
                        >
                          {
                            item.description
                          }
                        </p>

                        <span
                          style={
                            styles.activityDate
                          }
                        >
                          {
                            formatDate(
                              item.timestamp
                            )
                          }
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * ============================================================
 * COMPONENTS
 * ============================================================
 */

function StatusBadge({
  status,
}: {
  status: MissionStatus;
}) {
  return (
    <span
      style={
        getMissionStatusStyle(
          status
        )
      }
    >
      {
        status
      }
    </span>
  );
}

function TaskStatusBadge({
  status,
}: {
  status: TaskStatus;
}) {
  return (
    <span
      style={
        getTaskStatusStyle(
          status
        )
      }
    >
      {
        status
      }
    </span>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={
        styles.infoCard
      }
    >
      <span
        style={
          styles.infoLabel
        }
      >
        {
          label
        }
      </span>

      <strong
        style={
          styles.infoValue
        }
      >
        {
          value
        }
      </strong>
    </div>
  );
}

function TeamMember({
  task,
  agent,
}: {
  task: MissionTask;
  agent?: Agent;
}) {
  return (
    <div
      style={
        styles.teamMember
      }
    >
      <div
        style={
          styles.teamAvatar
        }
      >
        {
          getRoleIcon(
            agent?.role ??
              task.role
          )
        }
      </div>

      <div
        style={
          styles.teamMemberInfo
        }
      >
        <strong>
          {agent
            ? agent.name
            : "Unassigned"}
        </strong>

        <span>
          {
            task.title
          }
        </span>
      </div>

      <TaskStatusBadge
        status={
          task.status
        }
      />
    </div>
  );
}

function ChatBubble({
  message,
}: {
  message: ChatMessage;
}) {
  const isUser =
    message.kind ===
    "user";

  return (
    <div
      style={
        isUser
          ? styles.chatRowUser
          : styles.chatRow
      }
    >
      <div
        style={
          isUser
            ? styles.chatBubbleUser
            : styles.chatBubble
        }
      >
        <div
          style={
            styles.chatAuthor
          }
        >
          {
            message.sender
          }

          <span>
            {
              message.role
            }
          </span>
        </div>

        <p
          style={
            styles.chatText
          }
        >
          {
            message.message
          }
        </p>
      </div>
    </div>
  );
}

function DeliveryCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div
      style={
        styles.deliveryCard
      }
    >
      <div
        style={
          styles.deliveryIcon
        }
      >
        {
          icon
        }
      </div>

      <strong>
        {
          title
        }
      </strong>

      <p
        style={
          styles.deliveryDescription
        }
      >
        {
          description
        }
      </p>

      <button
        disabled
        style={
          styles.disabledButton
        }
      >
        Coming next
      </button>
    </div>
  );
}

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function findAgent(
  agentId?: string
): Agent | undefined {
  if (!agentId) {
    return undefined;
  }

  return AGENTS.find(
    (agent) =>
      agent.id ===
      agentId
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

function createId(): string {
  return `${Date.now()}-${Math.random()
    .toString(
      36
    )
    .slice(
      2,
      9
    )}`;
}

function formatDate(
  value: string
): string {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleString();
}

function getMissionStatusStyle(
  status: MissionStatus
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
    "Ready"
  ) {
    return styles.statusReady;
  }

  return styles.statusPlanning;
}

function getTaskStatusStyle(
  status: TaskStatus
): React.CSSProperties {
  if (
    status ===
    "Completed"
  ) {
    return styles.taskCompleted;
  }

  if (
    status ===
    "In Progress"
  ) {
    return styles.taskProgress;
  }

  if (
    status ===
    "Ready"
  ) {
    return styles.taskReady;
  }

  return styles.taskPlanned;
}

/*
 * ============================================================
 * STORAGE
 * ============================================================
 */

function loadMissions(): Mission[] {
  try {
    const raw =
      localStorage.getItem(
        MISSION_STORAGE_KEY
      );

    if (!raw) {
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
    localStorage.setItem(
      MISSION_STORAGE_KEY,
      JSON.stringify(
        missions
      )
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadSelectedMissionId():
  | string
  | null {
  try {
    return localStorage.getItem(
      SELECTED_MISSION_KEY
    );
  } catch {
    return null;
  }
}

function saveSelectedMissionId(
  id: string
) {
  try {
    localStorage.setItem(
      SELECTED_MISSION_KEY,
      id
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadMessages(
  missionId: string
): ChatMessage[] {
  try {
    const raw =
      localStorage.getItem(
        CHAT_PREFIX +
          missionId
      );

    if (!raw) {
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

function saveMessages(
  missionId: string,
  messages: ChatMessage[]
) {
  try {
    localStorage.setItem(
      CHAT_PREFIX +
        missionId,
      JSON.stringify(
        messages
      )
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadActivity(
  missionId: string
): ActivityItem[] {
  try {
    const raw =
      localStorage.getItem(
        ACTIVITY_PREFIX +
          missionId
      );

    if (!raw) {
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

function saveActivity(
  missionId: string,
  activity: ActivityItem[]
) {
  try {
    localStorage.setItem(
      ACTIVITY_PREFIX +
        missionId,
      JSON.stringify(
        activity
      )
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadFiles(
  missionId: string
): ProjectFile[] {
  try {
    const raw =
      localStorage.getItem(
        FILES_PREFIX +
          missionId
      );

    if (!raw) {
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

function saveFiles(
  missionId: string,
  files: ProjectFile[]
) {
  try {
    localStorage.setItem(
      FILES_PREFIX +
        missionId,
      JSON.stringify(
        files
      )
    );
  } catch {
    // Ignore storage errors.
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
      "Inter, system-ui, sans-serif",
  },

  container: {
    maxWidth:
      "1080px",
    margin:
      "0 auto",
  },

  emptyPage: {
    maxWidth:
      "500px",
    margin:
      "100px auto",
    textAlign:
      "center",
    color:
      "#929aa1",
  },

  emptyIcon: {
    fontSize:
      "42px",
    marginBottom:
      "10px",
  },

  header: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "18px",
    marginBottom:
      "18px",
  },

  headerActions: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "8px",
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
      "30px",
    letterSpacing:
      "-0.03em",
  },

  subtitle: {
    margin:
      0,
    maxWidth:
      "760px",
    color:
      "#929aa1",
    lineHeight:
      1.6,
    fontSize:
      "14px",
  },

  missionSelect: {
    maxWidth:
      "220px",
    padding:
      "10px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "9px",
    background:
      "#121619",
    color:
      "#fff",
  },

  smallButton: {
    padding:
      "9px 12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "9px",
    background:
      "#171b1e",
    color:
      "#dfe3e6",
    fontWeight:
      700,
    cursor:
      "pointer",
  },

  progressCard: {
    padding:
      "18px",
    marginBottom:
      "15px",
    border:
      "1px solid #282e33",
    borderRadius:
      "15px",
    background:
      "#111518",
  },

  progressTop: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
  },

  progressLabel: {
    color:
      "#7c848b",
    fontSize:
      "10px",
    fontWeight:
      900,
    letterSpacing:
      "0.1em",
  },

  progressValue: {
    display:
      "block",
    marginTop:
      "4px",
    fontSize:
      "28px",
  },

  progressTrack: {
    height:
      "8px",
    marginTop:
      "14px",
    borderRadius:
      "999px",
    background:
      "#242a2e",
    overflow:
      "hidden",
  },

  progressFill: {
    height:
      "100%",
    borderRadius:
      "999px",
    background:
      "#f0b90b",
  },

  progressMeta: {
    display:
      "flex",
    justifyContent:
      "space-between",
    flexWrap:
      "wrap",
    gap:
      "8px",
    marginTop:
      "9px",
    color:
      "#727b82",
    fontSize:
      "11px",
  },

  tabs: {
    display:
      "flex",
    gap:
      "6px",
    overflowX:
      "auto",
    marginBottom:
      "12px",
  },

  tab: {
    flex:
      "0 0 auto",
    padding:
      "9px 11px",
    border:
      "1px solid #292f34",
    borderRadius:
      "9px",
    background:
      "#111518",
    color:
      "#8d959c",
    fontWeight:
      700,
    cursor:
      "pointer",
  },

  tabActive: {
    flex:
      "0 0 auto",
    padding:
      "9px 11px",
    border:
      "1px solid #f0b90b",
    borderRadius:
      "9px",
    background:
      "#f0b90b",
    color:
      "#111",
    fontWeight:
      900,
    cursor:
      "pointer",
  },

  notice: {
    marginBottom:
      "12px",
    padding:
      "11px 13px",
    border:
      "1px solid #383e43",
    borderRadius:
      "10px",
    background:
      "#15191c",
    color:
      "#b7bec4",
    fontSize:
      "12px",
  },

  grid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(320px, 1fr))",
    gap:
      "13px",
  },

  panel: {
    padding:
      "18px",
    border:
      "1px solid #252b30",
    borderRadius:
      "15px",
    background:
      "#111518",
  },

  panelHeader: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "16px",
  },

  panelTitle: {
    margin:
      "5px 0 0",
    fontSize:
      "20px",
  },

  panelSubtitle: {
    margin:
      "5px 0 0",
    color:
      "#7f878e",
    fontSize:
      "12px",
    lineHeight:
      1.5,
  },

  goal: {
    margin:
      "14px 0",
    color:
      "#b2b8bd",
    lineHeight:
      1.6,
  },

  infoGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(2, 1fr)",
    gap:
      "8px",
  },

  infoCard: {
    padding:
      "11px",
    border:
      "1px solid #252b30",
    borderRadius:
      "9px",
    background:
      "#0d1012",
  },

  infoLabel: {
    display:
      "block",
    color:
      "#737c83",
    fontSize:
      "10px",
    textTransform:
      "uppercase",
  },

  infoValue: {
    display:
      "block",
    marginTop:
      "4px",
    fontSize:
      "13px",
  },

  primaryButton: {
    width:
      "100%",
    marginTop:
      "15px",
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

  secondaryButton: {
    padding:
      "9px 12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "9px",
    background:
      "#171b1e",
    color:
      "#dfe3e6",
    fontWeight:
      700,
    cursor:
      "pointer",
  },

  disabledButton: {
    width:
      "100%",
    marginTop:
      "12px",
    padding:
      "11px",
    border:
      "none",
    borderRadius:
      "9px",
    background:
      "#292e32",
    color:
      "#636b71",
    cursor:
      "not-allowed",
  },

  budgetPill: {
    padding:
      "7px 10px",
    borderRadius:
      "999px",
    background:
      "#1b1810",
    color:
      "#f0b90b",
    fontWeight:
      900,
    fontSize:
      "12px",
  },

  teamList: {
    display:
      "grid",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  teamMember: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "10px",
    padding:
      "11px",
    border:
      "1px solid #252b30",
    borderRadius:
      "10px",
    background:
      "#0d1012",
  },

  teamAvatar: {
    width:
      "36px",
    height:
      "36px",
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "9px",
    background:
      "#171c20",
    fontSize:
      "18px",
  },

  teamMemberInfo: {
    flex:
      1,
    minWidth:
      0,
    display:
      "grid",
    gap:
      "2px",
  },

  teamMemberInfoSpan: {
    color:
      "#7e878d",
    fontSize:
      "11px",
  },

  taskList: {
    display:
      "grid",
    gap:
      "10px",
    marginTop:
      "16px",
  },

  taskCard: {
    display:
      "flex",
    gap:
      "12px",
    padding:
      "14px",
    border:
      "1px solid #272d32",
    borderRadius:
      "12px",
    background:
      "#0d1012",
  },

  taskAvatar: {
    width:
      "42px",
    height:
      "42px",
    flexShrink:
      0,
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "10px",
    background:
      "#171c20",
    fontSize:
      "20px",
  },

  taskMain: {
    flex:
      1,
    minWidth:
      0,
  },

  taskTop: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "10px",
  },

  taskRole: {
    display:
      "block",
    marginTop:
      "3px",
    color:
      "#7d858c",
    fontSize:
      "11px",
  },

  taskBudget: {
    flexShrink:
      0,
    color:
      "#f0b90b",
    fontSize:
      "12px",
    fontWeight:
      900,
  },

  taskDescription: {
    margin:
      "9px 0",
    color:
      "#929aa1",
    fontSize:
      "12px",
    lineHeight:
      1.55,
  },

  taskControls: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "8px",
    flexWrap:
      "wrap",
  },

  statusSelect: {
    padding:
      "8px",
    border:
      "1px solid #30373c",
    borderRadius:
      "8px",
    background:
      "#13181b",
    color:
      "#fff",
    fontSize:
      "11px",
  },

  teamGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(280px, 1fr))",
    gap:
      "9px",
    marginTop:
      "15px",
  },

  agentCard: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "10px",
    padding:
      "14px",
    border:
      "1px solid #272d32",
    borderRadius:
      "11px",
    background:
      "#0d1012",
  },

  agentAvatar: {
    width:
      "43px",
    height:
      "43px",
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "10px",
    background:
      "#171c20",
    fontSize:
      "20px",
  },

  agentInfo: {
    flex:
      1,
    minWidth:
      0,
    display:
      "grid",
    gap:
      "3px",
  },

  agentTask: {
    color:
      "#7f878e",
    fontSize:
      "11px",
  },

  agentBudget: {
    color:
      "#f0b90b",
    fontSize:
      "10px",
  },

  chatBox: {
    minHeight:
      "330px",
    maxHeight:
      "500px",
    overflowY:
      "auto",
    marginTop:
      "15px",
    padding:
      "11px",
    border:
      "1px solid #252b30",
    borderRadius:
      "11px",
    background:
      "#0b0f11",
  },

  emptyChat: {
    minHeight:
      "280px",
    display:
      "flex",
    flexDirection:
      "column",
    alignItems:
      "center",
    justifyContent:
      "center",
    gap:
      "7px",
    color:
      "#747c82",
  },

  chatRow: {
    display:
      "flex",
    marginBottom:
      "8px",
  },

  chatRowUser: {
    display:
      "flex",
    justifyContent:
      "flex-end",
    marginBottom:
      "8px",
  },

  chatBubble: {
    maxWidth:
      "82%",
    padding:
      "10px",
    border:
      "1px solid #2a3136",
    borderRadius:
      "11px",
    background:
      "#171c20",
  },

  chatBubbleUser: {
    maxWidth:
      "82%",
    padding:
      "10px",
    border:
      "1px solid #44391c",
    borderRadius:
      "11px",
    background:
      "#1f1c14",
  },

  chatAuthor: {
    display:
      "flex",
    gap:
      "6px",
    alignItems:
      "center",
    flexWrap:
      "wrap",
    fontSize:
      "11px",
  },

  chatAuthorSpan: {
    color:
      "#717a81",
    fontSize:
      "10px",
  },

  chatText: {
    margin:
      "7px 0 0",
    color:
      "#c8ced2",
    fontSize:
      "12px",
    lineHeight:
      1.5,
  },

  messageInput: {
    width:
      "100%",
    boxSizing:
      "border-box",
    marginTop:
      "12px",
    padding:
      "12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "10px",
    background:
      "#0b0f11",
    color:
      "#fff",
    resize:
      "vertical",
    outline:
      "none",
    fontFamily:
      "inherit",
  },

  fileList: {
    display:
      "grid",
    gap:
      "8px",
    marginTop:
      "15px",
  },

  fileRow: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "10px",
    padding:
      "11px",
    border:
      "1px solid #272d32",
    borderRadius:
      "10px",
    background:
      "#0d1012",
  },

  fileIcon: {
    width:
      "35px",
    height:
      "35px",
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "8px",
    background:
      "#171c20",
  },

  fileInfo: {
    flex:
      1,
    minWidth:
      0,
    display:
      "grid",
    gap:
      "2px",
  },

  fileInfoSpan: {
    color:
      "#7d858c",
    fontSize:
      "10px",
  },

  fileDate: {
    color:
      "#707980",
    fontSize:
      "10px",
  },

  comingSoon: {
    marginTop:
      "15px",
    padding:
      "13px",
    border:
      "1px solid #2d3439",
    borderRadius:
      "10px",
    background:
      "#13181b",
    color:
      "#a9b1b6",
    fontSize:
      "11px",
    lineHeight:
      1.55,
  },

  deliveryGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",
    gap:
      "10px",
    marginTop:
      "15px",
  },

  deliveryCard: {
    padding:
      "14px",
    border:
      "1px solid #272d32",
    borderRadius:
      "11px",
    background:
      "#0d1012",
  },

  deliveryIcon: {
    fontSize:
      "25px",
    marginBottom:
      "8px",
  },

  deliveryDescription: {
    color:
      "#818a91",
    fontSize:
      "11px",
    lineHeight:
      1.5,
  },

  activityList: {
    display:
      "grid",
    gap:
      "8px",
    marginTop:
      "15px",
  },

  activityRow: {
    display:
      "flex",
    alignItems:
      "flex-start",
    gap:
      "10px",
    padding:
      "11px",
    border:
      "1px solid #272d32",
    borderRadius:
      "10px",
    background:
      "#0d1012",
  },

  activityIcon: {
    width:
      "31px",
    height:
      "31px",
    display:
      "grid",
    placeItems:
      "center",
    borderRadius:
      "8px",
    background:
      "#171c20",
  },

  activityMain: {
    flex:
      1,
    minWidth:
      0,
  },

  activityDescription: {
    margin:
      "4px 0 0",
    color:
      "#818a91",
    fontSize:
      "11px",
    lineHeight:
      1.5,
  },

  activityDate: {
    display:
      "block",
    marginTop:
      "5px",
    color:
      "#697177",
    fontSize:
      "10px",
  },

  empty: {
    padding:
      "40px 18px",
    textAlign:
      "center",
    color:
      "#757e85",
  },

  missionPicker: {
    display:
      "grid",
    gap:
      "8px",
    marginTop:
      "18px",
  },

  missionPickerButton: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    gap:
      "12px",
    padding:
      "13px",
    border:
      "1px solid #272d32",
    borderRadius:
      "10px",
    background:
      "#111518",
    color:
      "#fff",
    cursor:
      "pointer",
    textAlign:
      "left",
  },

  statusPlanning: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#1b1c14",
    color:
      "#d8c767",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  statusReady: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#151d25",
    color:
      "#8fb8da",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  statusProgress: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#151d17",
    color:
      "#7ec992",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  statusCompleted: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#101916",
    color:
      "#7ed4a6",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  taskPlanned: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#1a1d20",
    color:
      "#898f94",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  taskReady: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#141c22",
    color:
      "#8eb9db",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  taskProgress: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#151d17",
    color:
      "#7fca92",
    fontSize:
      "10px",
    fontWeight:
      800,
  },

  taskCompleted: {
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    background:
      "#101a16",
    color:
      "#7fd4a8",
    fontSize:
      "10px",
    fontWeight:
      800,
  },
};