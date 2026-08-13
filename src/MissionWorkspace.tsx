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

type ChatMessage = {
  id: string;
  sender: string;
  role: string;
  message: string;
  timestamp: string;
  kind:
    | "user"
    | "agent"
    | "system";
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

const CHAT_STORAGE_PREFIX =
  "bnb_agent_marketplace_chat_";

const ACTIVITY_STORAGE_PREFIX =
  "bnb_agent_marketplace_activity_";

const FILES_STORAGE_PREFIX =
  "bnb_agent_marketplace_files_";

export default function MissionWorkspace() {
  const [
    missions,
    setMissions,
  ] = useState<Mission[]>(
    loadMissions()
  );

  const [
    selectedMissionId,
    setSelectedMissionId,
  ] = useState<string | null>(
    loadSelectedMissionId()
  );

  const [
    activeTab,
    setActiveTab,
  ] = useState<
    | "overview"
    | "tasks"
    | "team"
    | "chat"
    | "files"
    | "deliverables"
    | "activity"
  >("overview");

  const [
    newMessage,
    setNewMessage,
  ] = useState("");

  const [
    chatMessages,
    setChatMessages,
  ] = useState<ChatMessage[]>(
    []
  );

  const [
    activity,
    setActivity,
  ] = useState<ActivityItem[]>(
    []
  );

  const [
    files,
    setFiles,
  ] = useState<ProjectFile[]>(
    []
  );

  const [
    notice,
    setNotice,
  ] = useState("");

  const mission =
    missions.find(
      (
        item
      ) =>
        item.id ===
        selectedMissionId
    ) ?? null;

  /*
   * ========================================================
   * LOAD PROJECT DATA
   * ========================================================
   */

  useEffect(() => {
    if (!mission) {
      setChatMessages([]);
      setActivity([]);
      setFiles([]);

      return;
    }

    setChatMessages(
      loadChat(
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
  }, [
    mission?.id,
  ]);

  /*
   * ========================================================
   * AUTO-SELECT FIRST MISSION
   * ========================================================
   */

  useEffect(() => {
    if (
      !selectedMissionId &&
      missions.length >
        0
    ) {
      const first =
        missions[0];

      setSelectedMissionId(
        first.id
      );

      saveSelectedMissionId(
        first.id
      );
    }
  }, [
    missions,
    selectedMissionId,
  ]);

  /*
   * ========================================================
   * SELECT MISSION
   * ========================================================
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
   * ========================================================
   * REFRESH MISSIONS
   * ========================================================
   */

  function refreshMissions() {
    const refreshed =
      loadMissions();

    setMissions(
      refreshed
    );

    setNotice(
      "Workspace refreshed."
    );
  }

  /*
   * ========================================================
   * UPDATE TASK STATUS
   * ========================================================
   */

  function updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus
  ) {
    if (!mission) {
      return;
    }

    const updatedMissions =
      missions.map(
        (
          item
        ): Mission => {
          if (
            item.id !==
            mission.id
          ) {
            return item;
          }

          const updatedTasks =
            item.tasks.map(
              (
                task
              ): MissionTask =>
                task.id ===
                taskId
                  ? {
                      ...task,
                      status:
                        newStatus,
                    }
                  : task
            );

          const completed =
            updatedTasks.length >
              0 &&
            updatedTasks.every(
              (
                task
              ) =>
                task.status ===
                "Completed"
            );

          const started =
            updatedTasks.some(
              (
                task
              ) =>
                task.status ===
                  "Ready" ||
                task.status ===
                  "In Progress" ||
                task.status ===
                  "Completed"
            );

          const nextStatus: MissionStatus =
            completed
              ? "Completed"
              : started
              ? "In Progress"
              : "Planning";

          return {
            ...item,
            tasks:
              updatedTasks,
            status:
              nextStatus,
          };
        }
      );

    setMissions(
      updatedMissions
    );

    saveMissions(
      updatedMissions
    );

    const changedTask =
      mission.tasks.find(
        (
          task
        ) =>
          task.id ===
          taskId
      );

    addActivity(
      {
        title:
          `${changedTask?.title ?? "Task"} updated`,

        description:
          `Task status changed to ${newStatus}.`,

        icon:
          newStatus ===
          "Completed"
            ? "✅"
            : newStatus ===
              "In Progress"
            ? "🔄"
            : "📋",
      }
    );

    setNotice(
      "Task updated."
    );
  }

  /*
   * ========================================================
   * QUICK START PROJECT
   * ========================================================
   */

  function startProject() {
    if (!mission) {
      return;
    }

    const updatedMissions =
      missions.map(
        (
          item
        ): Mission => {
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
                    index ===
                    0
                      ? "In Progress"
                      : "Ready",
                })
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

    addActivity(
      {
        title:
          "Mission started",

        description:
          "The project team is ready to begin coordinated work.",

        icon:
          "🚀",
      }
    );

    addChatMessage(
      {
        sender:
          "Project Manager",

        role:
          "Project Manager",

        message:
          "Mission started. I have organized the team and will coordinate the work.",

        kind:
          "agent",
      }
    );

    setNotice(
      "Mission started. Team is ready."
    );
  }

  /*
   * ========================================================
   * SEND MESSAGE
   * ========================================================
   */

  function sendMessage() {
    if (
      !mission ||
      !newMessage.trim()
    ) {
      return;
    }

    addChatMessage(
      {
        sender:
          "You",

        role:
          "Client",

        message:
          newMessage.trim(),

        kind:
          "user",
      }
    );

    setNewMessage("");

    setNotice(
      "Message added to the project room."
    );
  }

  /*
   * ========================================================
   * ADD SYSTEM CHAT MESSAGE
   * ========================================================
   */

  function addChatMessage(
    message: Omit<
      ChatMessage,
      "id" | "timestamp"
    >
  ) {
    if (!mission) {
      return;
    }

    const item: ChatMessage =
      {
        ...message,

        id:
          createId(),

        timestamp:
          new Date().toISOString(),
      };

    const updated = [
      ...chatMessages,
      item,
    ];

    setChatMessages(
      updated
    );

    saveChat(
      mission.id,
      updated
    );
  }

  /*
   * ========================================================
   * ACTIVITY
   * ========================================================
   */

  function addActivity(
    activityInput: Omit<
      ActivityItem,
      "id" | "timestamp"
    >
  ) {
    if (!mission) {
      return;
    }

    const item: ActivityItem =
      {
        ...activityInput,

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
   * ========================================================
   * ADD DEMO ARTIFACT
   * ========================================================
   */

  function createDemoArtifact() {
    if (!mission) {
      return;
    }

    const existing =
      files.find(
        (
          file
        ) =>
          file.name ===
          "project-plan.md"
      );

    if (existing) {
      setNotice(
        "The project plan artifact already exists."
      );

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
      ...files,
    ];

    setFiles(
      updated
    );

    saveFiles(
      mission.id,
      updated
    );

    addActivity(
      {
        title:
          "Project artifact created",

        description:
          "Project Manager created project-plan.md.",

        icon:
          "📄",
      }
    );

    setNotice(
      "Demo project artifact created."
    );
  }

  /*
   * ========================================================
   * PROGRESS
   * ========================================================
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
          (
            task
          ) =>
            task.status ===
            "Completed"
        ).length;

      const inProgress =
        mission.tasks.filter(
          (
            task
          ) =>
            task.status ===
            "In Progress"
        ).length;

      const weighted =
        completed +
        inProgress *
          0.5;

      return Math.round(
        (weighted /
          mission.tasks.length) *
          100
      );
    }, [
      mission,
    ]);

  /*
   * ========================================================
   * NO MISSION STATE
   * ========================================================
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
            Create a mission in the Marketplace
            first. Your project workspace will
            appear here automatically.
          </p>

          <button
            onClick={
              refreshMissions
            }
            style={
              styles.secondaryButton
            }
          >
            Refresh Workspace
          </button>
        </div>
      </div>
    );
  }

  /*
   * ========================================================
   * MISSION NOT SELECTED
   * ========================================================
   */

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
            Select a Mission
          </h1>

          <div
            style={
              styles.missionPicker
            }
          >
            {missions.map(
              (
                item
              ) => (
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
                    U ·{" "}
                    {
                      item.status
                    }
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
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
                  event.target
                    .value
                )
              }
              style={
                styles.missionSelect
              }
            >
              {missions.map(
                (
                  item
                ) => (
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
                refreshMissions
              }
              style={
                styles.smallButton
              }
            >
              Refresh
            </button>
          </div>
        </div>

        {/* ================================================= */}
        {/* PROGRESS */}
        {/* ================================================= */}

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

            <MissionStatus
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
                  (
                    task
                  ) =>
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
              total tasks
            </span>

            <span>
              Budget{" "}
              {
                mission.budget
              }{" "}
              U
            </span>
          </div>
        </div>

        {/* ================================================= */}
        {/* TABS */}
        {/* ================================================= */}

        <div
          style={
            styles.tabs
          }
        >
          <TabButton
            active={
              activeTab ===
              "overview"
            }
            onClick={() =>
              setActiveTab(
                "overview"
              )
            }
          >
            Overview
          </TabButton>

          <TabButton
            active={
              activeTab ===
              "tasks"
            }
            onClick={() =>
              setActiveTab(
                "tasks"
              )
            }
          >
            Tasks
          </TabButton>

          <TabButton
            active={
              activeTab ===
              "team"
            }
            onClick={() =>
              setActiveTab(
                "team"
              )
            }
          >
            Team
          </TabButton>

          <TabButton
            active={
              activeTab ===
              "chat"
            }
            onClick={() =>
              setActiveTab(
                "chat"
              )
            }
          >
            Communication
          </TabButton>

          <TabButton
            active={
              activeTab ===
              "files"
            }
            onClick={() =>
              setActiveTab(
                "files"
              )
            }
          >
            Files
          </TabButton>

          <TabButton
            active={
              activeTab ===
              "deliverables"
            }
            onClick={() =>
              setActiveTab(
                "deliverables"
              )
            }
          >
            Deliverables
          </TabButton>

          <TabButton
            active={
              activeTab ===
              "activity"
            }
            onClick={() =>
              setActiveTab(
                "activity"
              )
            }
          >
            Activity
          </TabButton>
        </div>

        {/* ================================================= */}
        {/* NOTICE */}
        {/* ================================================= */}

        {notice && (
          <div
            style={
              styles.notice
            }
          >
            {notice}
          </div>
        )}

        {/* ================================================= */}
        {/* OVERVIEW */}
        {/* ================================================= */}

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

                <MissionStatus
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
                    mission.tasks
                      .length
                  )}
                />

                <InfoCard
                  label="Category"
                  value={
                    mission.category
                  }
                />

                <InfoCard
                  label="Created"
                  value={formatDate(
                    mission.createdAt
                  )}
                />
              </div>

              {mission.status ===
                "Planning" && (
                <button
                  onClick={
                    startProject
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
                    TEAM STATUS
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
                  (
                    task
                  ) => (
                    <TeamMember
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
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* TASKS */}
        {/* ================================================= */}

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
                  Each task will eventually become
                  an ERC-8183 sub-job.
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
                styles.workspaceTaskList
              }
            >
              {mission.tasks.map(
                (
                  task
                ) => (
                  <WorkspaceTask
                    key={
                      task.id
                    }
                    task={
                      task
                    }
                    onStatusChange={(
                      nextStatus
                    ) =>
                      updateTaskStatus(
                        task.id,
                        nextStatus
                      )
                    }
                  />
                )
              )}
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* TEAM */}
        {/* ================================================= */}

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

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  Specialist agents assigned to
                  this mission.
                </p>
              </div>
            </div>

            <div
              style={
                styles.teamGrid
              }
            >
              {mission.tasks.map(
                (
                  task
                ) => (
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
                          task.role
                        )
                      }
                    </div>

                    <div
                      style={
                        styles.agentMain
                      }
                    >
                      <strong>
                        {
                          task.role
                        }
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
                        Budget{" "}
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
                )
              )}
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* CHAT */}
        {/* ================================================= */}

        {activeTab ===
          "chat" && (
          <div
            style={
              styles.chatPanel
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
                  Team Communication
                </h2>

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  Client, coordinator, and agents
                  communicate in one project room.
                </p>
              </div>
            </div>

            <div
              style={
                styles.chatMessages
              }
            >
              {chatMessages.length ===
              0 ? (
                <div
                  style={
                    styles.emptyChat
                  }
                >
                  <div
                    style={
                      styles.emptyIcon
                    }
                  >
                    💬
                  </div>

                  <strong>
                    No messages yet
                  </strong>

                  <p>
                    Start the project conversation.
                  </p>
                </div>
              ) : (
                chatMessages.map(
                  (
                    message
                  ) => (
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

            <div
              style={
                styles.composer
              }
            >
              <textarea
                value={
                  newMessage
                }
                onChange={(
                  event
                ) =>
                  setNewMessage(
                    event.target
                      .value
                  )
                }
                placeholder="Send a message to the project team..."
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
                  !newMessage.trim()
                }
                style={
                  newMessage.trim()
                    ? styles.primaryButton
                    : styles.disabledButton
                }
              >
                Send Message
              </button>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* FILES */}
        {/* ================================================= */}

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
                  SHARED WORKSPACE
                </div>

                <h2
                  style={
                    styles.panelTitle
                  }
                >
                  Project Files
                </h2>

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  Shared artifacts produced by the
                  team will appear here.
                </p>
              </div>

              <button
                onClick={
                  createDemoArtifact
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
                <div
                  style={
                    styles.emptyIcon
                  }
                >
                  📁
                </div>

                <strong>
                  No project files yet
                </strong>

                <p>
                  Agents will place shared artifacts
                  here.
                </p>
              </div>
            ) : (
              <div
                style={
                  styles.fileList
                }
              >
                {files.map(
                  (
                    file
                  ) => (
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
                          styles.fileMain
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
                Next: Git integration
              </strong>

              <p>
                Software projects will connect
                agents to a shared repository so
                developers can work on the same codebase
                without overwriting one another.
              </p>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* DELIVERABLES */}
        {/* ================================================= */}

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
                  This is where the completed work will
                  be handed back to the user.
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
                description="Open the finished project in a browser."
                action="Open Preview"
                disabled
              />

              <DeliveryCard
                icon="💻"
                title="Source Code"
                description="Open the project repository or browse the code."
                action="View Code"
                disabled
              />

              <DeliveryCard
                icon="📦"
                title="Download"
                description="Download the final project as a ZIP archive."
                action="Download ZIP"
                disabled
              />

              <DeliveryCard
                icon="🚀"
                title="Deployment"
                description="Deploy the completed project."
                action="Deploy Project"
                disabled
              />
            </div>

            <div
              style={
                styles.deliveryInfo
              }
            >
              <strong>
                How final delivery will work
              </strong>

              <p>
                Agents create artifacts in the shared
                workspace. The final evaluator verifies
                the project. Once accepted, the
                marketplace produces the final project
                package and makes it available to the
                user.
              </p>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* ACTIVITY */}
        {/* ================================================= */}

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

                <p
                  style={
                    styles.panelSubtitle
                  }
                >
                  Everything that happens in the
                  project will be recorded here.
                </p>
              </div>
            </div>

            {activity.length ===
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
                  🕘
                </div>

                <strong>
                  No activity yet
                </strong>

                <p>
                  Start the mission to see activity.
                </p>
              </div>
            ) : (
              <div
                style={
                  styles.activityList
                }
              >
                {activity.map(
                  (
                    item
                  ) => (
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

                        <p>
                          {
                            item.description
                          }
                        </p>
                      </div>

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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={
        onClick
      }
      style={
        active
          ? styles.tabActive
          : styles.tab
      }
    >
      {
        children
      }
    </button>
  );
}

function MissionStatus({
  status,
}: {
  status: MissionStatus;
}) {
  return (
    <span
      style={
        getStatusStyle(
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

function WorkspaceTask({
  task,
  onStatusChange,
}: {
  task: MissionTask;
  onStatusChange: (
    status: TaskStatus
  ) => void;
}) {
  return (
    <div
      style={
        styles.workspaceTask
      }
    >
      <div
        style={
          styles.taskIconLarge
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
          styles.workspaceTaskMain
        }
      >
        <div
          style={
            styles.workspaceTaskTop
          }
        >
          <div>
            <strong
              style={
                styles.workspaceTaskTitle
              }
            >
              {
                task.title
              }
            </strong>

            <span
              style={
                styles.workspaceRole
              }
            >
              {
                task.role
              }
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
              onStatusChange(
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

function TeamMember({
  task,
}: {
  task: MissionTask;
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
            task.role
          )
        }
      </div>

      <div
        style={
          styles.teamMain
        }
      >
        <strong>
          {
            task.role
          }
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
            styles.chatHeader
          }
        >
          <strong>
            {
              message.sender
            }
          </strong>

          <span>
            {
              message.role
            }
          </span>

          <span>
            {
              formatTime(
                message.timestamp
              )
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
  action,
  disabled,
}: {
  icon: string;
  title: string;
  description: string;
  action: string;
  disabled?: boolean;
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

      <p>
        {
          description
        }
      </p>

      <button
        disabled={
          disabled
        }
        style={
          disabled
            ? styles.disabledButton
            : styles.primaryButton
        }
      >
        {
          action
        }
      </button>
    </div>
  );
}

/*
 * ============================================================
 * HELPERS
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

  if (
    value.includes(
      "project"
    ) ||
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
    .toString(36)
    .slice(2, 9)}`;
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

function formatTime(
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
    return "";
  }

  return date.toLocaleTimeString(
    [],
    {
      hour:
        "2-digit",

      minute:
        "2-digit",
    }
  );
}

/*
 * ============================================================
 * STORAGE
 * ============================================================
 */

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

function loadSelectedMissionId():
  | string
  | null {
  try {
    return window.localStorage.getItem(
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
    window.localStorage.setItem(
      SELECTED_MISSION_KEY,
      id
    );
  } catch {
    // Ignore storage failure.
  }
}

function loadChat(
  missionId: string
): ChatMessage[] {
  try {
    const raw =
      window.localStorage.getItem(
        CHAT_STORAGE_PREFIX +
          missionId
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

function saveChat(
  missionId: string,
  messages: ChatMessage[]
) {
  try {
    window.localStorage.setItem(
      CHAT_STORAGE_PREFIX +
        missionId,
      JSON.stringify(
        messages
      )
    );
  } catch {
    // Ignore storage failure.
  }
}

function loadActivity(
  missionId: string
): ActivityItem[] {
  try {
    const raw =
      window.localStorage.getItem(
        ACTIVITY_STORAGE_PREFIX +
          missionId
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

function saveActivity(
  missionId: string,
  items: ActivityItem[]
) {
  try {
    window.localStorage.setItem(
      ACTIVITY_STORAGE_PREFIX +
        missionId,
      JSON.stringify(
        items
      )
    );
  } catch {
    // Ignore storage failure.
  }
}

function loadFiles(
  missionId: string
): ProjectFile[] {
  try {
    const raw =
      window.localStorage.getItem(
        FILES_STORAGE_PREFIX +
          missionId
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

function saveFiles(
  missionId: string,
  items: ProjectFile[]
) {
  try {
    window.localStorage.setItem(
      FILES_STORAGE_PREFIX +
        missionId,
      JSON.stringify(
        items
      )
    );
  } catch {
    // Ignore storage failure.
  }
}

/*
 * ============================================================
 * STATUS STYLES
 * ============================================================
 */

function getStatusStyle(
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
    "Planning"
  ) {
    return styles.statusPlanning;
  }

  return styles.statusReady;
}

function getTaskStatusStyle(
  status: TaskStatus
): React.CSSProperties {
  if (
    status ===
    "Completed"
  ) {
    return styles.taskStatusCompleted;
  }

  if (
    status ===
    "In Progress"
  ) {
    return styles.taskStatusProgress;
  }

  if (
    status ===
    "Ready"
  ) {
    return styles.taskStatusReady;
  }

  return styles.taskStatusPlanned;
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
      "1100px",

    margin:
      "0 auto",
  },

  emptyPage: {
    maxWidth:
      "520px",

    margin:
      "100px auto",

    textAlign:
      "center",

    color:
      "#9aa1a7",
  },

  emptyIcon: {
    fontSize:
      "42px",

    marginBottom:
      "14px",
  },

  header: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "flex-start",

    gap:
      "20px",

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

    flexShrink:
      0,
  },

  missionSelect: {
    maxWidth:
      "230px",

    padding:
      "10px",

    borderRadius:
      "9px",

    border:
      "1px solid #343a3f",

    background:
      "#121619",

    color:
      "#fff",

    outline:
      "none",
  },

  eyebrow: {
    fontSize:
      "10px",

    fontWeight:
      900,

    letterSpacing:
      "0.14em",

    color:
      "#7f888f",
  },

  title: {
    margin:
      "7px 0",

    fontSize:
      "30px",

    lineHeight:
      1.1,

    letterSpacing:
      "-0.03em",
  },

  subtitle: {
    margin:
      0,

    maxWidth:
      "750px",

    color:
      "#929aa1",

    lineHeight:
      1.6,

    fontSize:
      "14px",
  },

  progressCard: {
    padding:
      "18px",

    marginBottom:
      "16px",

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

    gap:
      "16px",
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
    width:
      "100%",

    height:
      "8px",

    marginTop:
      "14px",

    borderRadius:
      "999px",

    background:
      "#252a2e",

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

    transition:
      "width .25s ease",
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
      "10px",

    fontSize:
      "11px",

    color:
      "#707980",
  },

  tabs: {
    display:
      "flex",

    gap:
      "7px",

    overflowX:
      "auto",

    paddingBottom:
      "5px",

    marginBottom:
      "12px",
  },

  tab: {
    flex:
      "0 0 auto",

    padding:
      "10px 12px",

    borderRadius:
      "9px",

    border:
      "1px solid #292f34",

    background:
      "#111518",

    color:
      "#90989f",

    fontWeight:
      700,

    cursor:
      "pointer",

    whiteSpace:
      "nowrap",
  },

  tabActive: {
    flex:
      "0 0 auto",

    padding:
      "10px 12px",

    borderRadius:
      "9px",

    border:
      "1px solid #f0b90b",

    background:
      "#f0b90b",

    color:
      "#111",

    fontWeight:
      900,

    cursor:
      "pointer",

    whiteSpace:
      "nowrap",
  },

  notice: {
    marginBottom:
      "12px",

    padding:
      "11px 13px",

    borderRadius:
      "10px",

    background:
      "#151a1d",

    border:
      "1px solid #31383d",

    color:
      "#b7bec4",

    fontSize:
      "13px",
  },

  grid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(auto-fit, minmax(320px, 1fr))",

    gap:
      "14px",
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
      "6px 0 0",

    fontSize:
      "20px",

    letterSpacing:
      "-0.02em",
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
      "15px 0",

    color:
      "#b2b8bd",

    lineHeight:
      1.6,
  },

  infoGrid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(2, minmax(0, 1fr))",

    gap:
      "8px",
  },

  infoCard: {
    padding:
      "12px",

    borderRadius:
      "10px",

    background:
      "#0c0f11",

    border:
      "1px solid #242a2e",
  },

  infoLabel: {
    display:
      "block",

    color:
      "#747d84",

    fontSize:
      "10px",

    textTransform:
      "uppercase",

    letterSpacing:
      "0.08em",
  },

  infoValue: {
    display:
      "block",

    marginTop:
      "5px",

    fontSize:
      "13px",
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

    borderRadius:
      "10px",

    background:
      "#0c0f11",

    border:
      "1px solid #242a2e",
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

  teamMain: {
    flex:
      1,

    minWidth:
      0,

    display:
      "grid",

    gap:
      "2px",
  },

  teamMainSpan: {
    color:
      "#7f878e",

    fontSize:
      "11px",
  },

  primaryButton: {
    width:
      "100%",

    marginTop:
      "16px",

    padding:
      "13px 16px",

    border:
      "none",

    borderRadius:
      "10px",

    background:
      "#f0b90b",

    color:
      "#101010",

    fontWeight:
      900,

    cursor:
      "pointer",
  },

  secondaryButton: {
    marginTop:
      "14px",

    padding:
      "10px 13px",

    borderRadius:
      "9px",

    border:
      "1px solid #343a3f",

    background:
      "#171b1e",

    color:
      "#e0e4e7",

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
      "#2a2f33",

    color:
      "#626a70",

    fontWeight:
      800,

    cursor:
      "not-allowed",
  },

  budgetPill: {
    padding:
      "7px 10px",

    borderRadius:
      "999px",

    background:
      "#1d1a11",

    color:
      "#f0b90b",

    fontWeight:
      900,

    fontSize:
      "12px",
  },

  workspaceTaskList: {
    display:
      "grid",

    gap:
      "10px",

    marginTop:
      "16px",
  },

  workspaceTask: {
    display:
      "flex",

    gap:
      "13px",

    padding:
      "15px",

    borderRadius:
      "12px",

    border:
      "1px solid #272d32",

    background:
      "#0c1012",
  },

  taskIconLarge: {
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

  workspaceTaskMain: {
    flex:
      1,

    minWidth:
      0,
  },

  workspaceTaskTop: {
    display:
      "flex",

    justifyContent:
      "space-between",

    alignItems:
      "flex-start",

    gap:
      "12px",
  },

  workspaceTaskTitle: {
    display:
      "block",

    fontSize:
      "14px",
  },

  workspaceRole: {
    display:
      "block",

    marginTop:
      "3px",

    color:
      "#737c83",

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
      "#939ba2",

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
      "9px",

    flexWrap:
      "wrap",
  },

  statusSelect: {
    padding:
      "8px",

    borderRadius:
      "8px",

    border:
      "1px solid #30373c",

    background:
      "#13181b",

    color:
      "#fff",

    fontSize:
      "11px",
  },

  taskStatusPlanned: {
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

  taskStatusReady: {
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

  taskStatusProgress: {
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

  taskStatusCompleted: {
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

  agentCard: {
    display:
      "flex",

    alignItems:
      "center",

    gap:
      "12px",

    padding:
      "15px",

    borderRadius:
      "12px",

    border:
      "1px solid #272d32",

    background:
      "#0c1012",
  },

  teamGrid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(auto-fit, minmax(280px, 1fr))",

    gap:
      "10px",

    marginTop:
      "16px",
  },

  agentAvatar: {
    width:
      "45px",

    height:
      "45px",

    display:
      "grid",

    placeItems:
      "center",

    borderRadius:
      "11px",

    background:
      "#171c20",

    fontSize:
      "21px",
  },

  agentMain: {
    flex:
      1,

    minWidth:
      0,

    display:
      "grid",

    gap:
      "2px",
  },

  agentTask: {
    color:
      "#858d94",

    fontSize:
      "11px",
  },

  agentBudget: {
    color:
      "#f0b90b",

    fontSize:
      "10px",

    marginTop:
      "3px",
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

  chatPanel: {
    padding:
      "18px",

    border:
      "1px solid #252b30",

    borderRadius:
      "15px",

    background:
      "#111518",
  },

  chatMessages: {
    minHeight:
      "360px",

    maxHeight:
      "540px",

    overflowY:
      "auto",

    marginTop:
      "18px",

    padding:
      "12px",

    borderRadius:
      "12px",

    background:
      "#0b0f11",

    border:
      "1px solid #22282c",
  },

  emptyChat: {
    minHeight:
      "300px",

    display:
      "flex",

    flexDirection:
      "column",

    justifyContent:
      "center",

    alignItems:
      "center",

    textAlign:
      "center",

    color:
      "#777f86",
  },

  chatRow: {
    display:
      "flex",

    justifyContent:
      "flex-start",

    marginBottom:
      "10px",
  },

  chatRowUser: {
    display:
      "flex",

    justifyContent:
      "flex-end",

    marginBottom:
      "10px",
  },

  chatBubble: {
    maxWidth:
      "82%",

    padding:
      "11px",

    borderRadius:
      "11px 11px 11px 3px",

    background:
      "#171c20",

    border:
      "1px solid #2a3136",
  },

  chatBubbleUser: {
    maxWidth:
      "82%",

    padding:
      "11px",

    borderRadius:
      "11px 11px 3px 11px",

    background:
      "#1f1d14",

    border:
      "1px solid #423a1c",
  },

  chatHeader: {
    display:
      "flex",

    gap:
      "7px",

    alignItems:
      "center",

    flexWrap:
      "wrap",

    fontSize:
      "10px",
  },

  chatText: {
    margin:
      "7px 0 0",

    color:
      "#c6cbcf",

    fontSize:
      "12px",

    lineHeight:
      1.55,
  },

  composer: {
    marginTop:
      "12px",
  },

  messageInput: {
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
      "#0b0f11",

    color:
      "#fff",

    resize:
      "vertical",

    fontFamily:
      "inherit",

    outline:
      "none",
  },

  fileList: {
    display:
      "grid",

    gap:
      "8px",

    marginTop:
      "18px",
  },

  fileRow: {
    display:
      "flex",

    alignItems:
      "center",

    gap:
      "11px",

    padding:
      "12px",

    borderRadius:
      "10px",

    border:
      "1px solid #272d32",

    background:
      "#0c1012",
  },

  fileIcon: {
    width:
      "37px",

    height:
      "37px",

    display:
      "grid",

    placeItems:
      "center",

    borderRadius:
      "9px",

    background:
      "#171c20",
  },

  fileMain: {
    flex:
      1,

    minWidth:
      0,

    display:
      "grid",

    gap:
      "3px",
  },

  fileMainSpan: {
    color:
      "#777f86",

    fontSize:
      "10px",
  },

  fileDate: {
    color:
      "#6f777e",

    fontSize:
      "10px",
  },

  comingSoon: {
    marginTop:
      "16px",

    padding:
      "14px",

    borderRadius:
      "11px",

    background:
      "#15191c",

    border:
      "1px solid #2e3439",

    color:
      "#aeb5ba",

    fontSize:
      "12px",

    lineHeight:
      1.6,
  },

  deliveryGrid: {
    display:
      "grid",

    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",

    gap:
      "10px",

    marginTop:
      "18px",
  },

  deliveryCard: {
    padding:
      "15px",

    borderRadius:
      "12px",

    border:
      "1px solid #282e33",

    background:
      "#0c1012",
  },

  deliveryIcon: {
    fontSize:
      "25px",

    marginBottom:
      "10px",
  },

  deliveryCardP: {
    margin:
      "6px 0",

    color:
      "#858e95",

    fontSize:
      "12px",

    lineHeight:
      1.55,
  },

  deliveryInfo: {
    marginTop:
      "16px",

    padding:
      "14px",

    borderRadius:
      "11px",

    background:
      "#13181b",

    border:
      "1px solid #2b3237",

    color:
      "#adb4b9",

    fontSize:
      "12px",

    lineHeight:
      1.6,
  },

  activityList: {
    display:
      "grid",

    gap:
      "8px",

    marginTop:
      "16px",
  },

  activityRow: {
    display:
      "flex",

    alignItems:
      "flex-start",

    gap:
      "11px",

    padding:
      "12px",

    borderRadius:
      "10px",

    border:
      "1px solid #272d32",

    background:
      "#0c1012",
  },

  activityIcon: {
    width:
      "32px",

    height:
      "32px",

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

  activityMainP: {
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
    color:
      "#697177",

    fontSize:
      "10px",

    whiteSpace:
      "nowrap",
  },

  empty: {
    padding:
      "45px 20px",

    textAlign:
      "center",

    color:
      "#747d84",
  },

  missionPicker: {
    display:
      "grid",

    gap:
      "8px",

    marginTop:
      "20px",
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

    width:
      "100%",

    padding:
      "14px",

    borderRadius:
      "11px",

    border:
      "1px solid #272d32",

    background:
      "#111518",

    color:
      "#fff",

    cursor:
      "pointer",

    textAlign:
      "left",
  },

  smallButton: {
    padding:
      "9px 12px",

    borderRadius:
      "9px",

    border:
      "1px solid #353c41",

    background:
      "#171b1e",

    color:
      "#e0e4e7",

    fontWeight:
      700,

    cursor:
      "pointer",
  },
};
