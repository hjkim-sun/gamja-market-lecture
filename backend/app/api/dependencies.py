"""Process-scoped repositories shared by all API routers."""

from app.api.auth import _auth_service, _user_repository
from app.repositories.applications import create_application_repository
from app.repositories.chats import create_chat_repository
from app.repositories.requests import create_purchase_request_repository
from app.services.applications import ApplicationService
from app.services.chats import ChatService
from app.services.requests import PurchaseRequestService


request_repository = create_purchase_request_repository()
chat_repository = create_chat_repository()
application_repository = create_application_repository(request_repository, chat_repository)
requests_service = PurchaseRequestService(request_repository, _auth_service, application_repository)
applications_service = ApplicationService(application_repository, request_repository, chat_repository, _user_repository, _auth_service)
chats_service = ChatService(chat_repository, request_repository, _user_repository, _auth_service)
