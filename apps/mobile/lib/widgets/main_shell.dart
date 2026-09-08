import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// 主導航殼：看板 / 借款人 / 貸款 / 設定（見 spec §6）。
class MainShell extends StatelessWidget {
  const MainShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  static const _tabs = [
    (
      path: '/dashboard',
      label: '看板',
      icon: Icons.dashboard_outlined,
      selectedIcon: Icons.dashboard,
    ),
    (
      path: '/borrowers',
      label: '借款人',
      icon: Icons.people_outline,
      selectedIcon: Icons.people,
    ),
    (
      path: '/loans',
      label: '貸款',
      icon: Icons.request_page_outlined,
      selectedIcon: Icons.request_page,
    ),
    (
      path: '/settings',
      label: '設定',
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
    ),
  ];

  int get _currentIndex {
    final idx = _tabs.indexWhere((t) => location.startsWith(t.path));
    return idx == -1 ? 0 : idx;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: child),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) => context.go(_tabs[index].path),
        destinations: [
          for (final tab in _tabs)
            NavigationDestination(
              icon: Icon(tab.icon),
              selectedIcon: Icon(tab.selectedIcon),
              label: tab.label,
            ),
        ],
      ),
    );
  }
}
