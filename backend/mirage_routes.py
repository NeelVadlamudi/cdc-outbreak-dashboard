"""Mirage audit endpoints: ask, list proposals and the audit log, and approve or reject a proposal.

Approving or rejecting needs the X-API-Key header (ADMIN_API_KEY) and the deciding person's name.
A decision changes the proposal's status and adds an audit_log row; it changes no Mirage record.
"""

import asyncio
import logging
import secrets

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from backend import config
from mirage import state

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


class AuditQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class Decision(BaseModel):
    decided_by: str = Field(min_length=1, max_length=100, description="Name of the person deciding")
    note: str | None = Field(default=None, max_length=500)


def _require_admin(key: str | None):
    if not config.ADMIN_API_KEY:
        raise HTTPException(503, "Approvals are disabled: ADMIN_API_KEY is not set.")
    if not key or not secrets.compare_digest(key, config.ADMIN_API_KEY):
        raise HTTPException(401, "Missing or wrong X-API-Key.")


@router.post("/mirage/ask")
async def mirage_ask(body: AuditQuestion):
    from mirage.agent import run_audit

    try:
        return await asyncio.to_thread(run_audit, body.question)
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e


@router.get("/mirage/proposals")
async def mirage_proposals(status: str | None = None):
    return {"proposals": state.list_proposals(status)}


@router.get("/mirage/audit-log")
async def mirage_audit_log(proposal_id: int | None = None):
    return {"audit_log": state.audit_log(proposal_id)}


def _decide(pid: int, decision: str, body: Decision, key: str | None):
    _require_admin(key)
    try:
        out = state.decide(pid, decision, body.decided_by, body.note)
    except state.DecisionError as e:
        raise HTTPException(e.code, str(e)) from e
    logger.info("proposal decided", extra={"event": "proposal_decision", "proposal_id": pid,
                                           "decision": decision, "decided_by": body.decided_by})
    return out


@router.post("/proposals/{pid}/approve")
async def approve(pid: int, body: Decision, x_api_key: str | None = Header(default=None)):
    return _decide(pid, "approved", body, x_api_key)


@router.post("/proposals/{pid}/reject")
async def reject(pid: int, body: Decision, x_api_key: str | None = Header(default=None)):
    return _decide(pid, "rejected", body, x_api_key)
