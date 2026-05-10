import { useCallback, useState } from 'react';
import {
  isFirstRunWizardCurrent,
  loadFirstRunWizardRecord,
  markFirstRunWizardCompleted,
  markFirstRunWizardSkipped,
} from './firstRunPreferences';

export function useFirstRunWizard() {
  const [record, setRecord] = useState(loadFirstRunWizardRecord);

  const complete = useCallback(() => {
    setRecord(markFirstRunWizardCompleted());
  }, []);

  const skip = useCallback(() => {
    setRecord(markFirstRunWizardSkipped());
  }, []);

  return {
    record,
    shouldShow: !isFirstRunWizardCurrent(record),
    complete,
    skip,
  };
}
