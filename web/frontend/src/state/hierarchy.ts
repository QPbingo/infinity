import { Store } from './store'
import type { SSEEvent } from '../sse/manager'

export interface Workspace { id: number; name: string; description: string; status: string; created_at: number; updated_at: number }
export interface Project { id: number; workspace_id: number; name: string; description: string; status: string; created_at: number; updated_at: number }
export interface Topic { id: number; project_id: number; name: string; description: string; agent_type: string; status: string; created_at: number; updated_at: number }
export interface Story { id: number; topic_id: number; name: string; description: string; session_key: string; status: string; created_at: number; updated_at: number }

export interface WorkspaceNode {
  workspace: Workspace
  projects: ProjectNode[]
}
export interface ProjectNode {
  project: Project
  topics: TopicNode[]
}
export interface TopicNode {
  topic: Topic
  stories: Story[]
}
export interface HierarchyTree {
  workspaces: WorkspaceNode[]
}

class HierarchyStore extends Store {
  tree: HierarchyTree | null = null
  selectedWorkspaceId: number | null = null
  selectedTopicId: number | null = null
  selectedStoryId: number | null = null
  selectedTopicName = ''
  // Tree-node expansion state, keyed by node id string (e.g. "ws_1").
  expandedNodes: Record<string, boolean> = {}

  setTree(tree: HierarchyTree): void {
    this.tree = tree
    // Default to the first workspace if none selected.
    if (this.selectedWorkspaceId === null && tree.workspaces?.length) {
      this.selectedWorkspaceId = tree.workspaces[0].workspace.id
    }
    this.notify()
  }

  applyEvent(event: SSEEvent): void {
    if (event.type === 'hierarchy_snapshot' || event.type === 'hierarchy_updated') {
      this.setTree(event.hierarchy as HierarchyTree)
    }
  }

  selectWorkspace(id: number): void {
    this.selectedWorkspaceId = id
    this.selectedTopicId = null
    this.selectedStoryId = null
    this.notify()
  }

  selectTopic(id: number, name: string): void {
    this.selectedTopicId = id
    this.selectedStoryId = null
    this.selectedTopicName = name
    this.expandedNodes['topic_' + id] = true
    this.notify()
  }

  selectStory(id: number): void {
    this.selectedStoryId = id
    this.selectedTopicId = null
    this.notify()
  }

  toggleNode(key: string): void {
    // Default to expanded (true); first click collapses.
    const current = this.expandedNodes[key] !== false
    this.expandedNodes[key] = !current
    this.notify()
  }
}

export const hierarchyStore = new HierarchyStore()
