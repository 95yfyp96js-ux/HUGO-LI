import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';
import '../../widgets/format.dart';

/// 借款人清單（見 spec §1「借款人管理」）。
class BorrowerListScreen extends ConsumerWidget {
  const BorrowerListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final borrowersAsync = ref.watch(borrowersStreamProvider);
    final borrowerRepo = ref.watch(borrowerRepositoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('借款人')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/borrowers/new'),
        icon: const Icon(Icons.person_add),
        label: const Text('新增借款人'),
      ),
      body: borrowersAsync.when(
        data: (borrowers) {
          if (borrowers.isEmpty) {
            return const Center(child: Text('尚無借款人，請點右下角新增'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            itemCount: borrowers.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final borrower = borrowers[index];
              return Card(
                child: ListTile(
                  title: Text(borrower.name),
                  subtitle: Text(
                    '身分證 ${borrowerRepo.maskedIdNumber(borrower)}'
                    '${borrower.phone != null ? ' · ${borrower.phone}' : ''}',
                  ),
                  trailing: Text(formatDate(borrower.createdAt)),
                  onTap: () =>
                      context.push('/loans/new?borrowerId=${borrower.id}'),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('讀取失敗：$err')),
      ),
    );
  }
}
