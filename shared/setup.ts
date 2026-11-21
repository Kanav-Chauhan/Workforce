// The setup checklist's fixes. The Run button may only run a command from this fixed list,
// picked by id: the browser never sends a command line.

export interface SetupFix {
  id: string;
  label: string;
  /** What runs in the terminal, per platform. */
  linux: string;
  mac: string;
}

export const SETUP_FIXES: SetupFix[] = [
  { id: "git", label: "Install git", linux: "sudo apt-get install -y git", mac: "brew install git" },
  { id: "gh", label: "Install the GitHub CLI", linux: "sudo apt-get install -y gh", mac: "brew install gh" },
  { id: "gh-auth", label: "Log in to GitHub", linux: "gh auth login", mac: "gh auth login" },
  { id: "tmux", label: "Install tmux", linux: "sudo apt-get install -y tmux", mac: "brew install tmux" },
  { id: "claude", label: "Install Claude Code", linux: "npm install -g @anthropic-ai/claude-code", mac: "npm install -g @anthropic-ai/claude-code" },
];

export const setupFix = (id: string) => SETUP_FIXES.find((f) => f.id === id);
export const fixCommand = (f: SetupFix, platform: string) => (platform === "darwin" ? f.mac : f.linux);
