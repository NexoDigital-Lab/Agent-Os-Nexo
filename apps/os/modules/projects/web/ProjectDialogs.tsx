// Always mounted (shell overlay): opens the new/delete dialogs when any module asks.
import { useEffect, useState } from "react";
import { notify } from "../../shell/web/nav";
import { DeleteProject } from "./DeleteProject";
import { NewProject } from "./NewProject";
import { onOpenDeleteProject, onOpenNewProject, projectCreated, projectDeleted } from "./events";
import { refreshProjects } from "./store";

export function ProjectDialogs() {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => onOpenNewProject(() => setCreating(true)), []);
  useEffect(() => onOpenDeleteProject(setDeleting), []);
  return (
    <>
      {creating && (
        <NewProject
          onClose={() => (setCreating(false), void refreshProjects())}
          onDone={(c, setup) => {
            setCreating(false);
            projectCreated({ id: c.id, url: c.url, setup });
          }}
        />
      )}
      {deleting && (
        <DeleteProject
          id={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async (steps, gone) => {
            const id = deleting;
            setDeleting(null);
            await refreshProjects();
            projectDeleted({ id, gone });
            notify(steps.join(" · "));
          }}
        />
      )}
    </>
  );
}
