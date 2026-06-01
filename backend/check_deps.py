import os

try:
    from funasr import AutoModel
    print('FunASR: Available')
except ImportError as e:
    print(f'FunASR: Not available - {e}')

try:
    from dashscope.audio import asr
    print('DashScope: Available')
except ImportError as e:
    print(f'DashScope: Not available - {e}')

try:
    from openai import OpenAI
    print('OpenAI SDK: Available')
except ImportError as e:
    print(f'OpenAI SDK: Not available - {e}')

api_key = os.getenv('DASHSCOPE_API_KEY', '')
if api_key:
    print('DASHSCOPE_API_KEY: set')
else:
    print('DASHSCOPE_API_KEY: NOT SET')
