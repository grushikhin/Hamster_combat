interface Upgrade {
    id: string;
    name: string;
    price: number;
    profitPerHour: number;
    condition: {
        _type: string;
        moreReferralsCount: number;
    };
    cooldownSeconds: number;
    section: string;
    level: number;
    currentProfitPerHour: number;
    profitPerHourDelta: number;
    isAvailable: boolean;
    isExpired: boolean;
    totalCooldownSeconds: number;
}