"""Input contracts only; no human test results are generated here."""
import importlib.util
from pathlib import Path
import pytest

path=Path(__file__).resolve().parents[1]/'scripts/evaluate-mobile-reference.py'
spec=importlib.util.spec_from_file_location('mobile_reference',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def test_absent_human_data_is_blocked_not_zero_error():
    r=module.evaluate({'sessions':[]})
    assert r['status']=='BLOCKED_NO_PAIRED_HUMAN_DATA'
    assert r['mae_bpm'] is None and r['coverage'] is None
    assert r['human_sessions']==0


def test_unattested_data_cannot_enter_human_metrics():
    with pytest.raises(ValueError,match='provenance'):
        module.evaluate({'sessions':[{'provenance':'synthetic'}]})
