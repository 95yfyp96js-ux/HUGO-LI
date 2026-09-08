import { mockFaithService } from './mock';
import type { FaithService } from './types';

/**
 * 唯一的替換點：未來要接真實後端時，只需要在這裡把 mockFaithService
 * 換成 realFaithService（實作同一個 FaithService 介面），其餘程式碼不需變動。
 */
export const faithService: FaithService = mockFaithService;

export { MOCK_USER_ID } from './mock/storage';
export type { FaithService } from './types';
