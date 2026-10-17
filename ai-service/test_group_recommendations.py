import unittest
from unittest.mock import patch, Mock

from ai_service import AIServiceError, OLLAMA_MODEL, ask_json, chat_reply
from group_recommendations import recommend_groups


class GroupRecommendationTests(unittest.TestCase):
    def setUp(self):
        self.groups = [{"group_id": 1, "specialty": "Database", "description": "Student portal"}]
        self.match = {"group_id": 1, "reason": "SQL fits the database work.", "matched_skills": ["SQL"]}

    @patch("group_recommendations.ask_json")
    def test_uses_shared_model_and_data_only_prompt(self, ask):
        ask.return_value = {"recommendations": [self.match]}
        self.assertEqual(recommend_groups(["SQL"], self.groups)["recommendations"], [self.match])
        self.assertNotIn("model", ask.call_args.kwargs)
        self.assertEqual(ask.call_args.kwargs["num_ctx"], 8192)
        fields = ask.call_args.kwargs["response_schema"]["properties"]["recommendations"]["items"]["properties"]
        self.assertEqual(fields["group_id"]["enum"], [1])
        self.assertEqual(fields["matched_skills"]["items"]["enum"], ["SQL"])
        self.assertIn("untrusted data", ask.call_args.args[0])

    @patch("group_recommendations.ask_json")
    def test_rejects_hallucinations_and_duplicates(self, ask):
        ask.return_value = {"recommendations": [None, {**self.match, "group_id": 99}, self.match, self.match,
                                                 {**self.match, "group_id": True}]}
        self.assertEqual(recommend_groups(["SQL"], self.groups)["recommendations"], [self.match])

    @patch("group_recommendations.ask_json")
    def test_invalid_output_is_error_but_empty_matches_are_valid(self, ask):
        for response in [{}, {"recommendations": None}, {"recommendations": [{**self.match, "matched_skills": ["Invented"]}]}]:
            ask.return_value = response
            with self.assertRaises(AIServiceError):
                recommend_groups(["SQL"], self.groups)
        ask.return_value = {"recommendations": []}
        self.assertEqual(recommend_groups(["SQL"], self.groups), {"recommendations": []})

    @patch("ai_service.requests.post")
    def test_ollama_always_receives_llama_3_2_1b_and_json_mode(self, post):
        response = Mock()
        response.json.return_value = {"message": {"content": '{"recommendations": []}'}}
        post.return_value = response
        ask_json("system", "prompt", num_ctx=8192)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "llama3.2:1b")
        self.assertEqual(payload["format"], "json")
        self.assertFalse(payload["stream"])
        schema = {"type": "object", "properties": {"recommendations": {"type": "array"}}}
        ask_json("system", "prompt", response_schema=schema)
        self.assertEqual(post.call_args.kwargs["json"]["format"], schema)

    @patch("ai_service.requests.post")
    def test_malformed_ollama_json_is_service_error(self, post):
        post.return_value.json.return_value = {"message": {"content": 'not json'}}
        with self.assertRaises(AIServiceError):
            ask_json("system", "prompt")

    @patch("ai_service.requests.post")
    def test_chat_and_health_use_the_same_fixed_model(self, post):
        import main
        post.return_value.json.return_value = {"message": {"content": "Hello"}}
        chat_reply("system", [{"role": "user", "content": "hello"}])
        self.assertEqual(OLLAMA_MODEL, "llama3.2:1b")
        self.assertEqual(post.call_args.kwargs["json"]["model"], OLLAMA_MODEL)
        self.assertEqual(main.health()["model"], OLLAMA_MODEL)

    def test_endpoint_requires_shared_token_and_bounded_payload(self):
        import main
        from fastapi.testclient import TestClient
        with patch.object(main, "AI_SERVICE_TOKEN", "test-secret"), patch.object(main, "recommend_groups", return_value={"recommendations": [self.match]}) as generate:
            client = TestClient(main.app)
            body = {"skills": ["SQL"], "groups": self.groups}
            self.assertEqual(client.post("/recommend-groups", json=body).status_code, 401)
            headers = {"x-ai-service-token": "test-secret"}
            self.assertEqual(client.post("/recommend-groups", json={**body, "groups": self.groups * 13}, headers=headers).status_code, 422)
            self.assertEqual(client.post("/recommend-groups", json={**body, "skills": []}, headers=headers).status_code, 422)
            self.assertEqual(client.post("/recommend-groups", json=body, headers=headers).json(), {"recommendations": [self.match]})
            self.assertEqual(generate.call_count, 1)


if __name__ == "__main__":
    unittest.main()
