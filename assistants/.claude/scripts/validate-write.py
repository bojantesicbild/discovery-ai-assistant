#!/usr/bin/env python3
"""PostToolUse hook: validates frontmatter on docs/ file writes."""
import sys, json, re


def main():
    try:
        data = json.load(sys.stdin)
        tool_input = data.get("tool_input", {})
        file_path = tool_input.get("file_path", "")

        # Only validate files in docs/ or .memory-bank/docs/ directories
        if "/docs/" not in file_path:
            sys.exit(0)

        # Read the file that was just written
        try:
            with open(file_path, "r") as f:
                content = f.read()
        except (FileNotFoundError, PermissionError):
            sys.exit(0)

        # Check for YAML frontmatter
        if not content.startswith("---"):
            print(f"WARNING: {file_path} is missing YAML frontmatter (should start with ---)")
            sys.exit(0)

        # Extract frontmatter
        fm_match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
        if not fm_match:
            print(f"WARNING: {file_path} has malformed YAML frontmatter (missing closing ---)")
            sys.exit(0)

        frontmatter = fm_match.group(1)

        errors = []

        # Check for date field
        if not re.search(r"^date\s*:", frontmatter, re.MULTILINE):
            errors.append("missing 'date' field")

        # Check for category field
        if not re.search(r"^category\s*:", frontmatter, re.MULTILINE):
            errors.append("missing 'category' field")

        # Check description length if present
        desc_match = re.search(r"^description\s*:\s*(.+)$", frontmatter, re.MULTILINE)
        if desc_match:
            desc = desc_match.group(1).strip().strip("\"'")
            if len(desc) > 150:
                errors.append(f"description is {len(desc)} chars (max 150)")

        if errors:
            print(f"WARNING: {file_path} frontmatter issues: {', '.join(errors)}")

    except Exception:
        pass  # Never block on errors

    sys.exit(0)


if __name__ == "__main__":
    main()
