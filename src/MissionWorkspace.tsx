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

  function refreshMissions() {
    setMissions(
      loadMissions()
    );

    setNotice(
      "Workspace refreshed."
    );
  }

  function updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus
  ) {
    if (!mission) {
      return;
    }

    const targetTask =
      mission.tasks.find(
        (
          task
        ) =>
          task.id ===
          taskId
      );

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

          const allCompleted =
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
            allCompleted
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

    addActivity({
      title:
        `${targetTask?.title ?? "Task"} updated`,

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
    });

    setNotice(
      "Task updated."
    );
  }

  function startProject() {
    if (!mission) {
      return;
    }

    const firstUnassigned =
      mission.tasks.find(
        (
          task
        ) =>
          !task.assignedAgentId
      );

    if (
      firstUnassigned
    ) {
      setNotice(
        "Assign agents to the mission tasks before starting the project."
      );

      setActiveTab(
        "tasks"
      );

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

    addActivity({
      title:
        "Mission started",
      description:
        "The assigned agent team is ready to begin coordinated work.",
      icon:
        "🚀",
    });

    addChatMessage({
      sender:
        "TaskPilot",
      role:
        "Project Manager",
      message:
        "Mission started. I have confirmed the assigned team and will coordinate the work.",
      kind:
        "agent",
    });

    setNotice(
      "Mission started. Team is ready."
    );
  }

  function sendMessage() {
    if (
      !mission ||
      !newMessage.trim()
    ) {
      return;
    }

    addChatMessage({
      sender:
        "You",
      role:
        "Client",
      message:
        newMessage.trim(),
      kind:
        "user",
    });

    setNewMessage("");

    setNotice(
      "Message added to the project room."
    );
  }

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

  function addActivity(
    item: Omit<
      ActivityItem,
      "id" | "timestamp"
    >
  ) {
    if (!mission) {
      return;
    }

    const activityItem: ActivityItem =
      {
        ...item,
        id:
          createId(),
        timestamp:
          new Date().toISOString(),
      };

    const updated = [
      activityItem,
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

  function createDemoArtifact() {
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
        (
          item
        ) =>
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
      "Demo project artifact created."
    );
  }

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

      return Math.round(
        ((completed +
          inProgress *
            0.5) /
          mission.tasks.length) *
          100
      );
    }, [
      mission,
    ]);

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
            first.
          </p>

          <button
            onClick={
              refreshMissions
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

        <div
          style={
            styles.tabs
          }
        >
          {[
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
          ].map(
            (
              [
                key,
                label,
              ]
            ) => (
              <button
                key={
                  key
                }
                onClick={() =>
                  setActiveTab(
                    key as typeof activeTab
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
                    mission.tasks.length
                  )}
                />

                <InfoCard
                  label="Assigned"
                  value={`${mission.tasks.filter(
                    (
                      task
                    ) =>
                      Boolean(
                        task.assignedAgentId
                      )
                  ).length}/${
                    mission.tasks.length
                  }`}
                />

                <InfoCard
                  label="Category"
                  value={
                    mission.category
                  }
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
                  (
                    task
                  ) => {
                    const agent =
                      AGENTS.find(
                        (
                          item
                        ) =>
                          item.id ===
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
                  Each assigned task will become an
                  ERC-8183 sub-job in the next phase.
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
                ) => {
                  const agent =
                    AGENTS.find(
                      (
                        item
                      ) =>
                        item.id ===
                        task.assignedAgentId
                    );

                  return (
                    <WorkspaceTask
                      key={
                        task.id
                      }
                      task={
                        task
                      }
                      agent={
                        agent
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
                  );
                }
              )}
            </div>
          </div>
        )}

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
                  Assigned specialist agents for this
                  mission.
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
                ) => {
                  const agent =
                    AGENTS.find(
                      (
                        item
                      ) =>
                        item.id ===
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
                          styles.agentMain
                        }
                      >
                        <strong>
                          {
                            agent?.name ??
                              "Agent not assigned"
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
                          {
                            task.budget
                          }{" "}
                          U task budget
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
                  💬
                  <strong>
                    No messages yet
                  </strong>
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
        )}

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
                📁
                <p>
                  No files yet.
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
              Git repository integration for shared
              agent development.
            </div>
          </div>
        )}

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
                action="Open Preview"
              />

              <DeliveryCard
                icon="💻"
                title="Source Code"
                description="Browse the final repository."
                action="View Code"
              />

              <DeliveryCard
                icon="📦"
                title="Download"
                description="Download the final project ZIP."
                action="Download ZIP"
              />

              <DeliveryCard
                icon="🚀"
                title="Deployment"
                description="Deploy the completed project."
                action="Deploy Project"
              />
            </div>
          </div>
        )}

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

function WorkspaceTask({
  task,
  agent,
  onStatusChange,
}: {
  task: MissionTask;
  agent?: Agent;
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
            agent?.role ??
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
          styles.teamMain
        }
      >
        <strong>
          {agent
            ? agent.name
            : "Unassigned"}
        </strong>

        <span
          style={
            styles.teamTask
          }
        >
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
  const user =
    message.kind ===
    "user";

  return (
    <div
      style={
        user
          ? styles.chatRowUser
          : styles.chatRow
      }
    >
      <div
        style={
          user
            ? styles.chatBubbleUser
            : styles.chatBubble
        }
      >
        <strong>
          {
            message.sender
          }
        </strong>

        <span
          style={
            styles.chatRole
          }
        >
          {" "}
          ·{" "}
          {
            message.role
          }
        </span>

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
}: {
  icon: string;
  title: string;
  description: string;
  action: string;
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
        {
          action
        }
      </button>
    </div>
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
    .toString(36)
    .slice(2, 8)}`;
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
  files: ProjectFile[]
) {
  try {
    window.localStorage.setItem(
      FILES_STORAGE_PREFIX +
        missionId,
      JSON.stringify(
        files
      )
    );
  } catch {
    // Ignore storage failure.
  }
}

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
      "#939ca2",
  },

  emptyIcon: {
    fontSize:
      "42px",
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

    gap:
      "8px",

    alignItems:
      "center",
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

  teamMain: {
    flex:
      1,

    display:
      "grid",

    gap:
      "2px",
  },

  teamTask: {
    color:
      "#7e878d",

    fontSize:
      "11px",
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

  taskIconLarge: {
    width:
      "42px",

    height:
      "42px",

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

    gap:
      "10px",
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
      "#7d858c",

    fontSize:
      "11px",
  },

  taskBudget: {
    flexShrink:
      0,

    color:
      "#f0b90b",

    fontWeight:
      900,

    fontSize:
      "12px",
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

  agentMain: {
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

    color:
      "#747c82",

    gap:
      "8px",
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

  chatRole: {
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

  fileMain: {
    flex:
      1,

    display:
      "grid",

    gap:
      "2px",
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
  },

  activityMainP: {
    margin:
      "4px 0 0",

    color:
      "#818a91",

    fontSize:
      "11px",
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

    textAlign:
      "left",

    cursor:
      "pointer",
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

  teamTask: {
    color:
      "#7e878d",

    fontSize:
      "11px",
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
};
