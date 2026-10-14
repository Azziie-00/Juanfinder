import unittest
from unittest.mock import patch, Mock

from ai_service import AIServiceError, ask_json
from group_recommendations import recommend_groups, GROUP_RECOMMENDATION_MODEL


class GroupRecommendationTests(unittest.TestCase):
    def setUp(self):
        self.groups = [{"group_id": 1, "specialty": "Database", "description": "Student portal"}]
        self.match = {"group_id": 1, "reason": "SQL fits the database work.", "matched_skills": ["SQL"]}

    @patch("group_recommendations.ask_json")
    def test_uses_dedicated_llama_model_and_data_only_prompt(self, ask):
        ask.return_value = {"recommendations": [self.match]}
        self.assertEqual(recommend_groups(["SQL"], self.groups)["recommendations"], [self.match])
        self.assertEqual(ask.call_args.kwargs["model"], GROUP_RECOMMENDATION_MODEL)
        self.assertEqual(ask.call_args.kwargs["num_ctx"], 8192)
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
    def test_ollama_receives_explicit_model_and_json_mode(self, post):
        response = Mock()
        response.json.return_value = {"message": {"content": '{"recommendations": []}'}}
        post.return_value = response
        ask_json("system", "prompt", model="llama3.1:8b", num_ctx=8192)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "llama3.1:8b")
        self.assertEqual(payload["format"], "json")
        self.assertFalse(payload["stream"])

    @patch("ai_service.requests.post")
    def test_malformed_ollama_json_is_service_error(self, post):
        post.return_value.json.return_value = {"message": {"content": 'not json'}}
        with self.assertRaises(AIServiceError):
            ask_json("system", "prompt", model="llama3.1:8b")

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
