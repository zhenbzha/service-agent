import pytest

from test_specialist import MAX_SECTION_BYTES, MAX_SECTIONS, split_sections, tagged_text_problems


def test_valid_answer_has_no_problems():
    message = (
        "[thinking]Customer asks about a higher bill.\n"
        "[commentary]Your October bill was estimated.\n"
        "It is due on 16 November."
    )

    assert tagged_text_problems(message) == []


def test_lines_without_a_marker_continue_the_current_section():
    sections = split_sections("[commentary]First line.\nSecond line.\n[thinking]Note.")

    assert [(section.kind, section.text) for section in sections] == [
        ("commentary", "First line.\nSecond line."),
        ("thinking", "Note."),
    ]


@pytest.mark.parametrize(
    ("message", "problem"),
    [
        ("Hello\n[commentary]Hi.", "text before the first section marker"),
        ("[commentary]Hi.\n```", "line 2: code fence"),
        ("[commentary]Hi.\n[note]x", "line 2: starts with '[' but is not a section marker"),
        ("[commentary]Hi. [thinking]x", "line 1: section marker in the middle of a line"),
        ("[commentary]", "no section with text"),
    ],
)
def test_line_and_content_rules(message: str, problem: str):
    assert problem in tagged_text_problems(message)


def test_section_count_and_size_limits():
    too_long = "[commentary]" + "a" * (MAX_SECTION_BYTES + 1)
    combined_too_long = "\n".join(["[commentary]" + "a" * (MAX_SECTION_BYTES // 2)] * 3)
    too_many = "\n".join(["[thinking]x"] * (MAX_SECTIONS + 1))

    assert f"a [commentary] section is {MAX_SECTION_BYTES + 1} bytes" in tagged_text_problems(too_long)
    assert any(problem.startswith("combined [commentary] text") for problem in tagged_text_problems(combined_too_long))
    assert f"{MAX_SECTIONS + 1} sections (maximum {MAX_SECTIONS})" in tagged_text_problems(too_many)


def test_size_limit_counts_utf8_bytes():
    # "ä" is two bytes in UTF-8: within the limit in characters, over it in bytes.
    message = "[commentary]" + "ä" * (MAX_SECTION_BYTES // 2 + 1)

    assert f"a [commentary] section is {MAX_SECTION_BYTES + 2} bytes" in tagged_text_problems(message)
