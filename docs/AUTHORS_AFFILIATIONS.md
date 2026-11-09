# Authors and affiliations

Poster configuration version 2 stores `authors` and `affiliations` as arrays with stable UUIDs. An author has a display name, optional email and ORCID, `affiliationIds`, and corresponding or equal-contribution flags. Affiliations contain institution and optional department, city, country, and address.

Affiliation numbers follow the order of the affiliation array, starting at 1. Each author displays the numbers of their selected affiliations, followed by `*` for corresponding and `†` for equal contribution. Email addresses render in the contact line. Generated `config.tex` escapes user-supplied text and must be changed through poster settings, not edited directly.

Old flat `authors` and `affiliation` strings are parsed deterministically into the version 2 model. Read-only parsing preserves the original file until the project is deliberately updated or checkpointed. Back up `.overposter/projects` and `.overposter/versions` together before bulk migration.
