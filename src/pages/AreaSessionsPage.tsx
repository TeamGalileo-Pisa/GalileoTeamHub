import { MultiDayAllocationPanel } from "../components/MultiDayAllocationPanel";
import { SessionsPage } from "./SessionsPage";

export function AreaSessionsPage() {
  return <SessionsPage beforeCreate={<MultiDayAllocationPanel />} />;
}
