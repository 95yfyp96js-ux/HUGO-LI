import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ToastProvider } from '@/components/Toast';
import { HomePage } from '@/features/home/HomePage';
import { ExplorePage } from '@/features/explore/ExplorePage';
import { DeitySpacePage } from '@/features/explore/DeitySpacePage';
import { TempleDetailPage } from '@/features/explore/TempleDetailPage';
import { WorshipPage } from '@/features/worship/WorshipPage';
import { FortunePage } from '@/features/fortune/FortunePage';
import { FortuneResultPage } from '@/features/fortune/FortuneResultPage';
import { LanternListPage } from '@/features/lantern/LanternListPage';
import { LanternNewPage } from '@/features/lantern/LanternNewPage';
import { RitualListPage } from '@/features/ritual/RitualListPage';
import { RitualDetailPage } from '@/features/ritual/RitualDetailPage';
import { MyPage } from '@/features/my/MyPage';
import { NotFoundPage } from '@/features/misc/NotFoundPage';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/explore/deities/:deityId" element={<DeitySpacePage />} />
          <Route path="/explore/temples/:templeId" element={<TempleDetailPage />} />
          <Route path="/worship/:deityId" element={<WorshipPage />} />
          <Route path="/fortune/:deityId" element={<FortunePage />} />
          <Route path="/fortune/result/:ceremonyId" element={<FortuneResultPage />} />
          <Route path="/lantern" element={<LanternListPage />} />
          <Route path="/lantern/new/:deityId" element={<LanternNewPage />} />
          <Route path="/lantern/new" element={<LanternNewPage />} />
          <Route path="/ritual" element={<RitualListPage />} />
          <Route path="/ritual/:ritualId" element={<RitualDetailPage />} />
          <Route path="/my" element={<MyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
