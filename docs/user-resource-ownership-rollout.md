# Per-user resources: staging rollout

## Authorization
Owner sees all resources within their company. Managers and agents see inventory items they created. Existing inventory with NULL created_by is owner-only. Managers see only instances they created; agents currently cannot create or administer Evolution instances because the existing `admin` middleware denies them. Existing instances have NULL owner_user_id and remain owner-only until explicitly assigned. No cross-company access is granted.

## REQUIRED rollout sequence
1. Back up PostgreSQL. Run scripts/user_resource_ownership.sql before deploying the API branch.
2. Assign existing Evolution instances to actual users only after confirming ownership, using audited SQL (never guess owner).
3. Test owner/manager/agent with two users and two companies, including stock list, detail, edit, movements, interests, WhatsApp sending, instance list/status/connect and deletion.
4. Review frontend instance creation/assignment UI. Agent assignment is NOT implemented here.
5. Verify other business endpoints and public inventory image URLs: **public images remain accessible by UUID in compatibility mode**. This change is not complete media confidentiality.
6. Do not merge/deploy until the staging tests pass. Do not enable tenant RLS or signed media in this migration.

## Known follow-ups
- User-specific instance authorization must also cover send and conversation flows, not just instance management.
- Scope inventory image access, uploads, shared contact settings, notifications, and any additional downstream references consistently.
- Add explicit owner-controlled reassignment with audit logging.
