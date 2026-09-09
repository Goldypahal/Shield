from slowapi import Limiter
from slowapi.util import get_remote_address

# This uses the client's IP address to track requests.
# In a highly scalable production environment behind Kong or AWS API Gateway,
# ensure the 'X-Forwarded-For' header is correctly parsed.
limiter = Limiter(key_func=get_remote_address)
