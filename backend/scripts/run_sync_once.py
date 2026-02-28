from app.gmail_client import GmailClient
from app.supabase_client import SupabaseRepository
from app.sync_service import SyncService


def main() -> None:
    repo = SupabaseRepository()
    gmail = GmailClient()
    service = SyncService(repo, gmail)
    result = service.sync_all()
    print(result)


if __name__ == "__main__":
    main()
