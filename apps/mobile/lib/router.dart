import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'screens/borrowers/borrower_form_screen.dart';
import 'screens/borrowers/borrower_list_screen.dart';
import 'screens/dashboard/dashboard_screen.dart';
import 'screens/loans/loan_detail_screen.dart';
import 'screens/loans/loan_list_screen.dart';
import 'screens/loans/loan_register_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'widgets/main_shell.dart';

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> shellNavigatorKey = GlobalKey<NavigatorState>();

final GoRouter appRouter = GoRouter(
  navigatorKey: rootNavigatorKey,
  initialLocation: '/dashboard',
  routes: [
    ShellRoute(
      navigatorKey: shellNavigatorKey,
      builder: (context, state, child) =>
          MainShell(location: state.uri.toString(), child: child),
      routes: [
        GoRoute(
          path: '/dashboard',
          builder: (context, state) => const DashboardScreen(),
        ),
        GoRoute(
          path: '/borrowers',
          builder: (context, state) => const BorrowerListScreen(),
          routes: [
            GoRoute(
              path: 'new',
              parentNavigatorKey: rootNavigatorKey,
              builder: (context, state) => const BorrowerFormScreen(),
            ),
          ],
        ),
        GoRoute(
          path: '/loans',
          builder: (context, state) => const LoanListScreen(),
          routes: [
            GoRoute(
              path: 'new',
              parentNavigatorKey: rootNavigatorKey,
              builder: (context, state) {
                final borrowerId = state.uri.queryParameters['borrowerId'];
                return LoanRegisterScreen(preselectedBorrowerId: borrowerId);
              },
            ),
            GoRoute(
              path: ':loanId',
              parentNavigatorKey: rootNavigatorKey,
              builder: (context, state) =>
                  LoanDetailScreen(loanId: state.pathParameters['loanId']!),
            ),
          ],
        ),
        GoRoute(
          path: '/settings',
          builder: (context, state) => const SettingsScreen(),
        ),
      ],
    ),
  ],
);
