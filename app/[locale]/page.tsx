import { preload } from 'react-dom';
import { SuiPoolLanding } from '../../components/SuiPoolLanding';

// Homepage now highlights the HEDERA vault (ETHGlobal prize surface).
// Component is still named SuiPoolLanding (renaming would churn 1200 LOC
// of imports for a rebranding that's temporary until we decide the
// permanent primary chain). Data source inside is Hedera.
export default function HomePage() {
  // Preload the pool API — vault meter's LCP data lives here. Match the
  // exact URL the client fetch uses in SuiPoolLanding's fetchPoolSummary.
  preload('/api/community-pool?chain=hedera&network=testnet', {
    as: 'fetch',
    crossOrigin: 'anonymous',
  });
  return <SuiPoolLanding />;
}
