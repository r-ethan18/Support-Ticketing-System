# SPEC

## Features
- Ticket Creation and Management
- Creation of Supervisor and Vendor accounts by Admin
- Chat Functionality amongst Supervisor, User and Assignee
- [Optional] Automatic assigning of Assignees to tickets

## Role-wise functionality
### User
- *Create* their own accounts
- *Create* Tickets
- *Attach* media (evidence / proof) to tickets
- *View*, *Edit* and *Close* open tickets created by them
- Chat with **Supervisor** and **Assignee**
### Supervisor
- *View* and *Close* tickets belonging to their Department
- Assign appropriate **Assignees** (i.e. assignees suitable to work in that department) to tickets (multiple assignees can be assigned to a single ticket)
- Chat with **Users** and **Assignees**
### Assignee
- *View* tickets assigned to them
- *Attach* completion proof media to tickets
- Chat with **User** and **Supervisor**
### Admin
- *Create* and *Delete* accounts of **Supervisors** and **Assignees**
- *View*, *Close* and *Delete* any and all tickets (access to entire ticket db)

## Database Schema
```mermaid
erDiagram
  PERSON ||--o{ TICKET : "requests"
  PERSON ||--o{ TICKET_ASSIGNMENT : "assigned as"
  PERSON ||--o| PERSON_CREDENTIAL : "logs in with"
  VENDOR ||--o{ PERSON : "employs (LARP)"
  DEPARTMENT ||--o{ ASSET : "owns"
  DEPARTMENT ||--o{ PERSON : "supervisors belong to"
  CATEGORY ||--o{ ASSET : "classifies"
  PERSON }o--o{ CATEGORY : "assignee specializes in (via ASSIGNEE_CATEGORY)"
  PERSON }o--o{ ASSET : "supervisors define"
  ASSET ||--o{ TICKET : "subject of"
  TICKET ||--o{ TICKET_ASSIGNMENT : "has"
  TICKET ||--o{ TICKET_ATTACHMENT : "has"
  TICKET ||--o{ TICKET_COMMENT : "has"
  TICKET ||--o{ TICKET_STATUS_HISTORY : "logs"
  PERSON {
    uuid id PK
    string name
    string email
    string phone
    enum role "requester, assignee, supervisor, admin"
    uuid vendorID FK "nullable"
  }
  TICKET {
    uuid id PK
    string title
    string description
    string location
    enum priority
    enum status
    timestamptz createdAt
    timestamptz closedAt
    uuid requesterID FK
    uuid assetID FK "nullable (the user doesn't know this)"
    uuid supervisorID FK "nullable"
  }
  TICKET_ASSIGNMENT {
    uuid id PK
    uuid ticketID FK
    uuid assigneeID FK
    timestamptz assignedAt
    timestamptz unassignedAt
  }
  TICKET_ATTACHMENT {
    uuid id PK
    uuid ticketID FK
    uuid uploadedByID FK
    enum kind "issue_evidence, completion_proof"
    string storageUrl
    timestamptz uploadedAt
  }
  PERSON_CREDENTIAL {
    uuid personID PK, FK
    string passwordHash "Argon2 (pwdlib), never exposed by the API"
    timestamptz updatedAt
  }
```
