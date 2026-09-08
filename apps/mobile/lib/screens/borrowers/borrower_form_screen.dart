import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../domain/borrower_repository.dart';
import '../../providers/app_providers.dart';

/// 新增借款人（四步上手第 1 步）。身分證字號僅加密存放＋雜湊查重，
/// 不明文比對（見不變式 5）。
class BorrowerFormScreen extends ConsumerStatefulWidget {
  const BorrowerFormScreen({super.key});

  @override
  ConsumerState<BorrowerFormScreen> createState() => _BorrowerFormScreenState();
}

class _BorrowerFormScreenState extends ConsumerState<BorrowerFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _idCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _idCtrl.dispose();
    _phoneCtrl.dispose();
    _addressCtrl.dispose();
    _bankCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final repo = ref.read(borrowerRepositoryProvider);
      final borrower = await repo.create(
        name: _nameCtrl.text.trim(),
        idNumber: _idCtrl.text.trim(),
        phone: _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
        address: _addressCtrl.text.trim().isEmpty
            ? null
            : _addressCtrl.text.trim(),
        bankAccount: _bankCtrl.text.trim().isEmpty
            ? null
            : _bankCtrl.text.trim(),
      );
      if (!mounted) return;
      context.pushReplacement('/loans/new?borrowerId=${borrower.id}');
    } on DuplicateBorrowerException catch (e) {
      if (!mounted) return;
      final proceed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('已有相同身分證字號的借款人'),
          content: const Text('是否改為沿用既有借款人資料，直接登記貸款？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('沿用並登記貸款'),
            ),
          ],
        ),
      );
      if (proceed == true && mounted) {
        context.pushReplacement(
          '/loans/new?borrowerId=${e.existingBorrowerId}',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('新增借款人')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _nameCtrl,
              decoration: const InputDecoration(labelText: '姓名 *'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? '請輸入姓名' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _idCtrl,
              decoration: const InputDecoration(
                labelText: '身分證字號 *',
                helperText: '僅加密儲存於本機，畫面顯示時將以遮罩呈現',
              ),
              validator: (v) =>
                  (v == null || v.trim().length < 4) ? '請輸入正確的身分證字號' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phoneCtrl,
              decoration: const InputDecoration(labelText: '電話'),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _addressCtrl,
              decoration: const InputDecoration(
                labelText: '地址',
                helperText: '僅加密儲存於本機',
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _bankCtrl,
              decoration: const InputDecoration(
                labelText: '收款帳號',
                helperText: '僅加密儲存於本機',
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('儲存並下一步：登記貸款'),
            ),
          ],
        ),
      ),
    );
  }
}
