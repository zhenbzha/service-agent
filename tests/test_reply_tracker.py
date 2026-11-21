import pytest

from test_voice import QUIET_SECONDS_AFTER_REPLY, ReplyTracker, VoiceTestError, raise_on_error

QUIET = QUIET_SECONDS_AFTER_REPLY


def created(delegation_id: str) -> dict:
    return {"type": "session.delegation.created", "delegation": {"id": delegation_id}}


def done(delegation_id: str, status: str, error_code: str | None = None) -> dict:
    return {
        "type": "session.delegation.done",
        "delegation_id": delegation_id,
        "status": status,
        "error_code": error_code,
    }


def spoken(text: str) -> dict:
    return {"type": "session.output_transcript.delta", "delta": text}


def tracker_after(*events: dict) -> ReplyTracker:
    tracker = ReplyTracker(started_at=0.0, last_activity=0.0)
    for event in events:
        tracker.observe(event, now=0.0)
    return tracker


def test_reply_finishes_after_spoken_answer_and_quiet_period():
    tracker = tracker_after(created("d1"), done("d1", "completed"), spoken("Your bill is higher because..."))

    assert not tracker.is_finished(now=QUIET - 0.1)
    assert tracker.is_finished(now=QUIET)
    tracker.check_answered()


def test_reply_is_not_finished_while_a_delegation_is_open():
    tracker = tracker_after(spoken("Let me check."), created("d1"))

    assert not tracker.is_finished(now=QUIET * 10)


def test_cancelled_delegation_is_accepted_when_another_completes():
    tracker = tracker_after(created("d1"), created("d2"), done("d1", "cancelled"), done("d2", "completed"))

    tracker.check_answered()


def test_turn_whose_only_delegation_was_cancelled_is_not_answered():
    tracker = tracker_after(created("d1"), done("d1", "cancelled"), spoken("Sorry, one moment."))

    with pytest.raises(VoiceTestError, match="No delegation completed"):
        tracker.check_answered()


def test_turn_without_delegation_needs_no_specialist_answer():
    tracker_after(spoken("Hello, how can I help?")).check_answered()


def test_failed_delegation_raises():
    with pytest.raises(VoiceTestError, match="Delegation failed: timeout"):
        tracker_after(created("d1"), done("d1", "failed", "timeout"))


@pytest.mark.parametrize(
    "backend_event",
    [
        {"type": "response.failed", "response": {"id": "r1", "status": "failed"}},
        {"type": "response.incomplete", "response": {"id": "r1", "status": "incomplete"}},
        {"type": "response.completed", "response": {"id": "r1", "status": "failed"}},
    ],
)
def test_failed_specialist_response_raises(backend_event: dict):
    with pytest.raises(VoiceTestError, match="Specialist response"):
        raise_on_error({"type": "response.event", "event": backend_event})


def test_cancelled_specialist_response_is_not_an_error():
    raise_on_error(
        {"type": "response.event", "event": {"type": "response.cancelled", "response": {"status": "cancelled"}}}
    )
