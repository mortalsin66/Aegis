// ============================================================
// Донаты (поддержка проекта).
//
// ЕДИНСТВЕННОЕ место, которое нужно править: адреса кошельков
// в поле `address` ниже. Всё остальное (модалка, QR, копирование,
// ссылки на explorer) берёт данные отсюда.
//
// Адреса публичные — они показываются пользователям панели, чтобы
// те могли перевести тебе USDT. Это не секрет.
// ============================================================

export interface DonateOption {
  id: string
  coin: string
  network: string
  address: string
  /** Шаблон ссылки на explorer; {address} заменяется на реальный адрес. */
  explorer: string
}

export const DONATIONS: DonateOption[] = [
  {
    id: 'trc20',
    coin: 'USDT',
    network: 'TRC-20 (TRON)',
    address: 'TT95SXdQrXMeob8pQqBbiP1kvTsqdqA4hW',
    explorer: 'https://tronscan.org/#/address/{address}',
  },
  {
    id: 'erc20',
    coin: 'USDT',
    network: 'ERC-20 (Ethereum)',
    // Этот же 0x… адрес принимает USDT также на Polygon, Arbitrum,
    // Optimism и BNB Smart Chain (формат адреса везде одинаковый).
    address: '0x3b1ae446f117dbd9053ef722b6e1f0d96cb6a7ef',
    explorer: 'https://etherscan.io/address/{address}',
  },
]
