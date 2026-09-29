# Neutral language and project labels

Galleries use “Save collection” and “Saved collections”; the studio uses “guest access,” “gallery message” and “customer note.” New unnamed organizer collections use `Collection 001`, `Collection 002`, and so on. Technical hierarchy terms and internal identifiers are not roles.

## Optional checkout reference

At project creation or **Project settings → Order reference label**, set the exact text for the optional order-reference field: for example, **Participant name**, **Team**, **Product code**, or **Project reference**. A blank value uses **Order reference**. Labels are project-specific, limited to 80 characters, and rendered as plain text. The same label appears when viewing an order in the studio.

Existing subject labels are kept. Earlier role choices such as `child` continue to display “Child name(s)” until the studio changes that project’s label. Existing private collection names, gallery messages, catalog names, product descriptions and order references are not rewritten by an upgrade; edit owner-authored wording through the existing settings when appropriate.

No database or browser-storage migration is needed. For compatibility, `subject_label`, `parent_message`, `pk_family_*`, `family_add`/`family_remove`, and existing links remain unchanged internally. Saved collection choices, favorites, analytics history and orders therefore survive the wording change. The legacy SQL default is unchanged; the application explicitly sets a neutral reference label on every new project.
