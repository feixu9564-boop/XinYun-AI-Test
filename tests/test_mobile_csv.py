"""Record-contract examples, not human measurements or generated RGB data."""
import importlib.util
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('mobile_csv',Path(__file__).resolve().parents[1]/'scripts/analyze-mobile-csv.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def rows():
    ref=dict(schema_version='1',record_type='reference',session_id='s',subject_id='P001',reference_id='r',reference_bpm='72',reference_observed_at='2026-10-22T10:00:08Z')
    window=dict(ref,record_type='window',sample_start='2026-10-22T10:00:00Z',sample_end='2026-10-22T10:00:16Z',status='accepted',bpm='74',reason='accepted_experimental')
    return [window,ref,dict(window,status='insufficient_signal',bpm='',reason='no_face')]

def test_error_denominator_separate_from_coverage():
    report=module.analyze(rows())
    assert report['output_coverage']==.5 and report['rejection_rate']==.5
    assert report['error_metrics']['mae_bpm']==2 and report['paired_accepted_windows']==1

@pytest.mark.parametrize('change',[dict(subject_id='other'),dict(reference_observed_at='2026-10-22T10:00:15Z'),dict(reference_bpm='nan')])
def test_unmatched_reference_never_counts_as_zero_error(change):
    data=rows();data[1].update(change);report=module.analyze(data)
    assert report['paired_accepted_windows']==0 and report['error_metrics']['mae_bpm'] is None
    assert report['output_coverage']==.5

def test_empty_csv_has_null_metrics():
    report=module.analyze([])
    assert report['output_coverage'] is None and report['error_metrics']['mae_bpm'] is None
