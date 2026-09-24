from apiary.colors import hue_of, suggest


def test_first_suggestions_come_from_the_palette() -> None:
    assert suggest([], 2) == ["0.64 0.21 22", "0.64 0.21 152"]


def test_suggestion_fills_the_largest_hue_gap() -> None:
    assert suggest(["0.64 0.21 22"], 1) == ["0.64 0.21 251"]


def test_suggestions_avoid_the_olive_band_and_each_other() -> None:
    hues = [hue_of(c) for c in suggest(["0.64 0.21 22"], 10)]
    assert all(not 85 <= h <= 125 for h in hues)
    assert len(set(round(h) for h in hues)) == 10
